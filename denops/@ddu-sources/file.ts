import {
  type Context,
  type Item,
  type SourceOptions,
} from "jsr:@shougo/ddu-vim@~10.4.0/types";
import { BaseSource } from "jsr:@shougo/ddu-vim@~10.4.0/source";
import {
  printError,
  treePath2Filename,
} from "jsr:@shougo/ddu-vim@~10.4.0/utils";

import { type ActionData } from "jsr:@shougo/ddu-kind-file@~0.9.0";

import type { Denops } from "jsr:@denops/core@~7.0.0";
import * as fn from "jsr:@denops/std@~7.6.0/function";

import { join } from "jsr:@std/path@~1.1.0/join";
import { isAbsolute } from "jsr:@std/path@~1.1.0/is-absolute";
import { relative } from "jsr:@std/path@~1.1.0/relative";

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
          args.sourceOptions.path.length != 0
            ? args.sourceOptions.path
            : args.context.path,
        );

        const tree = async (root: string) => {
          const stat = await safeStat(root);
          if (!stat?.isDirectory) {
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
          if (args.input != "") {
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
          if (stat?.isDirectory) {
            controller.enqueue(await tree(rootPath));
          } else {
            // Check the file exists.
            const stat = await safeStat(basePath);
            if (stat) {
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
            } else {
              await printError(
                args.denops,
                `${rootPath} is not found.`,
              );
            }
          }
        }

        controller.close();
      },
    });
  }

  override async checkUpdated(args: {
    denops: Denops;
    sourceOptions: SourceOptions;
  }): Promise<boolean> {
    let dir = treePath2Filename(args.sourceOptions.path);
    if (dir == "") {
      dir = await fn.getcwd(args.denops) as string;
    }

    const stat = await safeStat(dir);
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
        const stat = await Deno.stat(path);
        stat.isSymlink = true;
        return stat;
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
