/* @flow */
// flowlint untyped-import:off
import { type ABI, type ContractRegister } from '@neo-one/client';
import {
  type DescribeTable,
  type PluginManager,
  compoundName,
} from '@neo-one/server-plugin';
import type { Observable } from 'rxjs/Observable';
import { ReplaySubject } from 'rxjs/ReplaySubject';

import { map, shareReplay } from 'rxjs/operators';
import fs from 'fs-extra';
import path from 'path';
import { utils } from '@neo-one/utils';

import {
  ABIRequiredError,
  ContractOrHashRequiredError,
  WalletRequiredError,
} from './errors';
import type SmartContractResourceType, {
  SmartContract,
} from './SmartContractResourceType';

import { getWallet } from './utils';

type SmartContractResourceOptions = {|
  resourceType: SmartContractResourceType,
  name: string,
  baseName: string,
  networkName: string,
  dataPath: string,
  configPath: string,
  abiPath: string,
  hash: string,
  contractName?: string,
  abi: ABI,
|};

type NewSmartContractResourceOptions = {|
  pluginManager: PluginManager,
  resourceType: SmartContractResourceType,
  name: string,
  abi?: ABI,
  contract?: {|
    name: string,
    register: ContractRegister,
  |},
  hash?: string,
  wallet?: string,
  dataPath: string,
|};

type ExistingSmartContractResourceOptions = {|
  pluginManager: PluginManager,
  resourceType: SmartContractResourceType,
  name: string,
  dataPath: string,
|};

const CONFIG_PATH = 'config.json';
const ABI_PATH = 'abi.json';

export default class SmartContractResource {
  _resourceType: SmartContractResourceType;
  _name: string;
  _baseName: string;
  _networkName: string;
  _dataPath: string;
  _configPath: string;
  _abiPath: string;
  _hash: string;
  _contractName: ?string;
  _abi: ABI;

  resource$: Observable<SmartContract>;

  constructor({
    resourceType,
    name,
    baseName,
    networkName,
    dataPath,
    configPath,
    abiPath,
    hash,
    contractName,
    abi,
  }: SmartContractResourceOptions) {
    this._resourceType = resourceType;
    this._name = name;
    this._baseName = baseName;
    this._networkName = networkName;
    this._dataPath = dataPath;
    this._configPath = configPath;
    this._abiPath = abiPath;
    this._hash = hash;
    this._contractName = contractName;
    this._abi = abi;

    const subject$ = new ReplaySubject();
    this.resource$ = subject$.pipe(
      map(() => this._toResource()),
      shareReplay(1),
    );
    subject$.next();
  }

  static async createNew({
    pluginManager,
    resourceType,
    name,
    abi,
    contract,
    hash: hashIn,
    wallet: walletName,
    dataPath,
  }: NewSmartContractResourceOptions): Promise<SmartContractResource> {
    const { name: baseName, names: [networkName] } = compoundName.extract(name);

    let hash = hashIn;
    if (abi == null) {
      throw new ABIRequiredError();
    }

    let contractName;
    if (contract != null) {
      if (walletName == null) {
        throw new WalletRequiredError();
      }

      const { client, wallet } = await getWallet({
        pluginManager,
        walletName,
      });

      const result = await client.publish(contract.register, {
        from: wallet.address,
      });
      const receipt = await result.confirmed();
      if (receipt.result.state === 'HALT') {
        // eslint-disable-next-line
        hash = receipt.result.value.hash;
      } else {
        throw new Error(receipt.result.message);
      }

      contractName = contract.name;
    } else {
      if (hashIn == null) {
        throw new ContractOrHashRequiredError();
      }

      hash = hashIn;
    }

    await fs.ensureDir(dataPath);
    const configPath = this._getConfigPath(dataPath);
    const abiPath = this._getABIPath(dataPath);
    await Promise.all([
      fs.writeJSON(configPath, { hash, contractName }),
      fs.writeJSON(abiPath, JSON.stringify(abi)),
    ]);

    return new SmartContractResource({
      resourceType,
      name,
      baseName,
      networkName,
      contractName,
      dataPath,
      configPath,
      abiPath,
      hash,
      abi,
    });
  }

  static async createExisting({
    resourceType,
    name,
    dataPath,
  }: ExistingSmartContractResourceOptions): Promise<SmartContractResource> {
    const { name: baseName, names: [networkName] } = compoundName.extract(name);

    const configPath = this._getConfigPath(dataPath);
    const abiPath = this._getABIPath(dataPath);
    const [{ hash, contractName }, abi] = await Promise.all([
      fs.readJSON(configPath),
      fs.readJSON(abiPath),
    ]);

    return new SmartContractResource({
      resourceType,
      name,
      baseName,
      networkName,
      contractName,
      dataPath,
      configPath,
      abiPath,
      hash,
      abi,
    });
  }

  async delete(): Promise<void> {
    await fs.remove(this._dataPath);
  }

  _toResource(): SmartContract {
    return {
      plugin: this._resourceType.plugin.name,
      resourceType: this._resourceType.name,
      name: this._name,
      baseName: this._baseName,
      state: 'stopped',
      network: this._networkName,
      contractName: this._contractName == null ? undefined : this._contractName,
      hash: this._hash,
      abi: this._abi,
    };
  }

  static _getConfigPath(dataPath: string): string {
    return path.resolve(dataPath, CONFIG_PATH);
  }

  static _getABIPath(dataPath: string): string {
    return path.resolve(dataPath, ABI_PATH);
  }

  getDebug(): DescribeTable {
    return [
      ['Data Path', this._dataPath],
      ['Config Path', this._configPath],
      ['ABI Path', this._abiPath],
    ].concat(
      // flowlint-next-line unclear-type:off
      utils.entries((this._toResource(): Object)).map(([key, val]) => {
        if (val == null) {
          return [key, 'null'];
        }
        return [
          key,
          typeof val === 'string' ? val : JSON.stringify(val, null, 2),
        ];
      }),
    );
  }
}
