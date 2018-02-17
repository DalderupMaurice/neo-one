/* @flow */
import { type Binary, killProcess } from '@neo-one/server-plugin';

import fs from 'fs-extra';
import isRunning from 'is-running';
import path from 'path';
import spawn from 'cross-spawn';
import { utils } from '@neo-one/utils';

import Client from './Client';

const SERVER_PID = 'server.pid';

const isSameVersion = async ({
  port,
  expectedVersion,
}: {|
  port: number,
  expectedVersion: string,
|}): Promise<boolean> => {
  const client = new Client({ port });
  const startTime = utils.nowSeconds();
  // eslint-disable-next-line
  while (utils.nowSeconds() - startTime <= 5) {
    try {
      const version = await client.getVersion();
      return version === expectedVersion;
    } catch (error) {
      // eslint-disable-next-line
    }
  }

  return false;
};

const waitRunning = async ({ pid }: {| pid: number |}) => {
  const startTime = utils.nowSeconds();
  // eslint-disable-next-line
  while (!isRunning(pid) && utils.nowSeconds() - startTime <= 5) {
    await new Promise(resolve => setTimeout(() => resolve(), 100));
  }
};

const waitReachable = async ({ port }: {| port: number |}) => {
  const client = new Client({ port });
  const startTime = utils.nowSeconds();
  let lastError;
  // eslint-disable-next-line
  while (utils.nowSeconds() - startTime <= 30) {
    try {
      await client.wait(1000);
      return;
    } catch (error) {
      await new Promise(resolve => setTimeout(() => resolve(), 100));
      lastError = error;
      // eslint-disable-next-line
    }
  }

  if (lastError != null) {
    throw lastError;
  }
};

export default class ServerManager {
  _dataPath: string;
  _serverVersion: string;

  constructor({
    dataPath,
    serverVersion,
  }: {|
    dataPath: string,
    serverVersion: string,
  |}) {
    this._dataPath = dataPath;
    this._serverVersion = serverVersion;
  }

  async getServerPID(): Promise<?number> {
    let pidContents;
    try {
      pidContents = await fs.readFile(this.pidPath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }

      throw error;
    }

    try {
      return parseInt(pidContents, 10);
    } catch (error) {
      await fs.remove(this.pidPath);
      return null;
    }
  }

  async checkAlive(port: number): Promise<?number> {
    const pid = await this.getServerPID();

    if (pid === process.pid) {
      return pid;
    }

    if (pid != null) {
      if (isRunning(pid)) {
        const sameVersion = await isSameVersion({
          port,
          expectedVersion: this._serverVersion,
        });
        if (sameVersion) {
          return pid;
        }

        await this.kill({ pid });
      }

      await fs.remove(this.pidPath);
    }

    return null;
  }

  async kill(optionsIn?: {| pid: number |}): Promise<void> {
    let { pid } = optionsIn || {};
    if (pid == null) {
      pid = await this.getServerPID();
    }
    if (pid == null) {
      return;
    }

    await killProcess(pid);
  }

  async start({
    port,
    binary,
    onStart,
  }: {|
    port: number,
    binary: Binary,
    onStart?: () => void,
  |}): Promise<{| pid: number, started: boolean |}> {
    const pid = await this.checkAlive(port);
    if (pid != null) {
      return { pid, started: false };
    }

    if (onStart != null) {
      onStart();
    }

    const child = spawn(
      binary.cmd,
      binary.firstArgs.concat(['start', 'server']),
      {
        detached: true,
        stdio: 'ignore',
      },
    );
    child.unref();

    await waitRunning({ pid: child.pid });
    await waitReachable({ port });

    return { pid: child.pid, started: true };
  }

  async writePID(pid: number): Promise<void> {
    await fs.ensureDir(path.dirname(this.pidPath));
    await fs.writeFile(this.pidPath, `${pid}`);
  }

  get pidPath(): string {
    return path.resolve(this._dataPath, SERVER_PID);
  }
}
