import type { Context, Item, SourceOptions } from "@shougo/ddu-vim/types";
import { BaseSource } from "@shougo/ddu-vim/source";
import { printError, treePath2Filename } from "@shougo/ddu-vim/utils";

import type { ActionData } from "@shougo/ddu-kind-file";

import type { Denops } from "@denops/std";

import { join } from "@std/path/join";
import { isAbsolute } from "@std/path/is-absolute";
import { relative } from "@std/path/relative";

type Params = {
  ignoreDirectories: boolean;
  new: boolean;
};

export class Source extends BaseSource<Params> {
  override kind = "file";

  override gather(args: {
    denops: Denops;
    context: Context;
    sourceOptions: SourceOptions;
    sourceParams: Params;
    input: string;
  }): ReadableStream<Item<ActionData>[]> {
    this.prevMtime = new Date();

    return new ReadableStream({
      async start(controller) {
        const maxItems = 20000;

        const basePath = treePath2Filename(
          args.sourceOptions.path.length > 0
            ? args.sourceOptions.path
            : args.context.path,
        );

        const tree = async (root: string) => {
          if (!(await safeStat(root))?.isDirectory) {
            return [];
          }

          let items: Item<ActionData>[] = [];
          try {
            for await (const entry of Deno.readDir(root)) {
              const path = join(root, entry.name);

              const stat = await safeStat(path);
              if (!stat) {
                continue;
              } else if (
                args.sourceParams.ignoreDirectories && stat.isDirectory
              ) {
                continue;
              }

              const word =
                (isAbsolute(args.input) ? path : relative(basePath, path)) +
                (stat.isDirectory ? "/" : "");

              items.push({
                word,
                action: {
                  path,
                  isDirectory: stat.isDirectory,
                  isLink: stat.isSymlink,
                },
                status: {
                  size: stat.size,
                  time: stat.mtime?.getTime(),
                },
                isTree: stat.isDirectory,
                treePath: path,
              });

              if (items.length > maxItems) {
                // Update items
                controller.enqueue(items);

                // Clear
                items = [];
              }
            }
          } catch (e: unknown) {
            if (e instanceof Error && e.name.includes("AbortReason")) {
              // Ignore AbortReason errors
            } else {
              console.error(e);
            }
          }

          return items;
        };

        if (args.sourceParams.new) {
          if (args.input.length > 0) {
            controller.enqueue(
              [{
                word: args.input,
                display: `[new] ${args.input}`,
                action: {
                  path: join(basePath, args.input),
                },
              }],
            );
          }
        } else {
          const slashPos = args.input.lastIndexOf("/");
          const rootPath = isAbsolute(args.input)
            ? args.input.slice(0, slashPos)
            : slashPos >= 0
            ? join(basePath, args.input.slice(0, slashPos))
            : basePath;

          const stat = await safeStat(basePath);
          if (!stat) {
            await printError(
              args.denops,
              `${basePath} is not found.`,
            );
          } else if (stat.isDirectory) {
            controller.enqueue(await tree(rootPath));
          } else {
            controller.enqueue(
              [{
                word: basePath,
                action: {
                  path: basePath,
                  isDirectory: stat.isDirectory,
                  isLink: stat.isSymlink,
                },
                status: {
                  size: stat.size,
                  time: stat.mtime?.getTime(),
                },
                isTree: stat.isDirectory,
                treePath: basePath,
              }],
            );
          }
        }

        controller.close();
      },
    });
  }

  override async checkUpdated(args: {
    denops: Denops;
    context: Context;
    sourceOptions: SourceOptions;
  }): Promise<boolean> {
    const basePath = treePath2Filename(
      args.sourceOptions.path.length > 0
        ? args.sourceOptions.path
        : args.context.path,
    );

    const stat = await safeStat(basePath);
    if (!stat || !stat.isDirectory || !stat.mtime) {
      return false;
    }

    const check = stat.mtime > this.prevMtime;
    this.prevMtime = stat.mtime;

    return check;
  }

  override params(): Params {
    return {
      ignoreDirectories: false,
      new: false,
    };
  }
}

const safeStat = async (path: string): Promise<Deno.FileInfo | null> => {
  // NOTE: Deno.stat() may be failed
  try {
    const stat = await Deno.lstat(path);
    if (stat.isSymlink) {
      try {
        return { ...await Deno.stat(path), isSymlink: true };
      } catch (_: unknown) {
        // Ignore stat exception
      }
    }
    return stat;
  } catch (_: unknown) {
    // Ignore stat exception
  }
  return null;
};
