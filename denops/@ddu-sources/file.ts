import {
  BaseSource,
  Context,
  Item,
  SourceOptions,
} from "https://deno.land/x/ddu_vim@v4.0.0/types.ts";
import { Denops, fn } from "https://deno.land/x/ddu_vim@v4.0.0/deps.ts";
import {
  printError,
  treePath2Filename,
} from "https://deno.land/x/ddu_vim@v4.0.0/utils.ts";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.7.1/file.ts";

import { join } from "jsr:@std/path@0.224.0";
import { isAbsolute, relative } from "jsr:@std/path@0.222.1";

type Params = {
  "new": boolean;
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
            console.error(e);
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
      "new": false,
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
