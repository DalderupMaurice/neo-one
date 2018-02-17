/* @flow */
import fs from 'fs-extra';

import Provider from './Provider';

import type { Environment } from '../types';

export default class MultiProvider extends Provider {
  _providers: Array<Provider>;
  _environment: Environment;

  constructor({
    providers,
    environment,
  }: {|
    providers: Array<Provider>,
    environment: Environment,
  |}) {
    super();
    this._providers = providers;
    this._environment = environment;
  }

  async restore(): Promise<void> {
    // eslint-disable-next-line
    for (const provider of this._providers) {
      const canRestore = await provider.canRestore();
      if (canRestore) {
        await provider.restore();
        break;
      }
    }
  }

  async backup(): Promise<void> {
    // eslint-disable-next-line
    for (const provider of this._providers) {
      await provider.backup();
      await fs.remove(this._environment.tmpPath);
      await fs.ensureDir(this._environment.tmpPath);
    }
  }
}
