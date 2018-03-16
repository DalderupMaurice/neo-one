/* @flow */
import type { Plugin } from '@neo-one/server-plugin';

import ora from 'ora';

import createCRUD from './createCRUD';

import type InteractiveCLI from '../InteractiveCLI';

export default ({ cli, plugin }: {| cli: InteractiveCLI, plugin: Plugin |}) => {
  const commands = createCRUD({ cli, plugin }).concat(
    plugin.interactive.map(interactiveCommand => interactiveCommand({ cli })),
  );
  commands.forEach(command => {
    const fn = command._fn;
    let cancelled = false;
    command.action(async args => {
      try {
        cancelled = false;
        await cli.executeCommandPreHooks(command._name, args);
        await fn(args);
        if (!cancelled) {
          await cli.executeCommandPostHooks(command._name, args);
        }
      } catch (error) {
        ora(error.message).fail();
        cli.monitor.withLabels({ 'command.name': command._name }).logError({
          name: 'command',
          error,
          message: `Command ${command._name} failed.`,
        });
      }
    });

    const cancel = command._cancel;
    if (cancel != null) {
      command.cancel(() => {
        cancelled = true;
        cancel();
      });
    }
  });

  plugin.cliPreHooks.forEach(({ name, hook }) => {
    cli.registerPreHook(name, hook);
  });

  plugin.cliPostHooks.forEach(({ name, hook }) => {
    cli.registerPostHook(name, hook);
  });
};
