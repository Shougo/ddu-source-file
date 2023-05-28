import {
  BaseSource,
  Item,
  SourceOptions,
} from "https://deno.land/x/ddu_vim@v2.9.0/types.ts";
import { Denops, fn } from "https://deno.land/x/ddu_vim@v2.9.0/deps.ts";
import { join } from "https://deno.land/std@0.177.1/path/mod.ts";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.4.2/file.ts";
import {
  isAbsolute,
  relative,
} from "https://deno.land/std@0.177.1/path/mod.ts";

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

        const basePath = args.sourceOptions.path != ""
          ? args.sourceOptions.path
          : await fn.getcwd(args.denops) as string;

        const tree = async (root: string) => {
          let items: Item<ActionData>[] = [];
          try {
            for await (const entry of Deno.readDir(root)) {
              const path = join(root, entry.name);

              const stat = await (async () => {
                let ret = await Deno.lstat(path);
                if (ret.isSymlink) {
                  try {
                    ret = await Deno.stat(path);
                    ret.isSymlink = true;
                  } catch (_: unknown) {
                    // Ignore stat exception
                  }
                }
                return ret;
              })();

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

          if (await isDirectory(rootPath)) {
            controller.enqueue(await tree(rootPath));
          } else if (!await isDirectory(basePath)) {
            await args.denops.call(
              "ddu#util#print_error",
              `${rootPath} is not directory.`,
            );
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
    let dir = args.sourceOptions.path;
    if (dir == "") {
      dir = await fn.getcwd(args.denops) as string;
    }

    if (!await isDirectory(dir)) {
      return false;
    }

    const stat = await Deno.stat(dir);
    if (!stat.mtime) {
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

const isDirectory = async (path: string) => {
  // Note: Deno.stat() may be failed
  try {
    if ((await Deno.stat(path)).isDirectory) {
      return true;
    }
  } catch (_e: unknown) {
    // Ignore
  }

  return false;
};
