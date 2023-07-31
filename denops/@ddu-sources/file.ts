import {
  BaseSource,
  Item,
  SourceOptions,
} from "https://deno.land/x/ddu_vim@v3.4.4/types.ts";
import { Denops, fn } from "https://deno.land/x/ddu_vim@v3.4.4/deps.ts";
import { treePath2Filename } from "https://deno.land/x/ddu_vim@v3.4.4/utils.ts";
import { join } from "https://deno.land/std@0.196.0/path/mod.ts";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.5.3/file.ts";
import {
  isAbsolute,
  relative,
} from "https://deno.land/std@0.196.0/path/mod.ts";

type Params = {
  "new": boolean;
};

export class Source extends BaseSource<Params> {
  override kind = "file";

  override gather(args: {
    denops: Denops;
    sourceOptions: SourceOptions;
    sourceParams: Params;
    input: string;
  }): ReadableStream<Item<ActionData>[]> {
    this.prevMtime = new Date();

    return new ReadableStream({
      async start(controller) {
        const maxItems = 20000;

        const basePath = args.sourceOptions.path.length != 0
          ? treePath2Filename(args.sourceOptions.path)
          : await fn.getcwd(args.denops) as string;

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
              await args.denops.call(
                "ddu#util#print_error",
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
    let stat = await Deno.lstat(path);
    if (stat.isSymlink) {
      try {
        stat = await Deno.stat(path);
        stat.isSymlink = true;
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
