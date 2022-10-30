import {
  BaseSource,
  Item,
  SourceOptions,
} from "https://deno.land/x/ddu_vim@v.1.13.0/types.ts";
import { Denops, fn } from "https://deno.land/x/ddu_vim@v.1.13.0/deps.ts";
import { join, resolve } from "https://deno.land/std@0.161.0/path/mod.ts";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.3.1/file.ts";
import { relative } from "https://deno.land/std@0.161.0/path/mod.ts";

type Params = {
  "new": boolean;
};

export class Source extends BaseSource<Params> {
  kind = "file";

  gather(args: {
    denops: Denops;
    sourceOptions: SourceOptions;
    sourceParams: Params;
    input: string;
  }): ReadableStream<Item<ActionData>[]> {
    this.prevMtime = new Date();

    return new ReadableStream({
      async start(controller) {
        const maxItems = 20000;

        let dir = args.sourceOptions.path;
        if (dir == "") {
          dir = await fn.getcwd(args.denops) as string;
        }

        const tree = async (root: string) => {
          let items: Item<ActionData>[] = [];
          try {
            for await (const entry of Deno.readDir(root)) {
              const path = join(root, entry.name);
              const stat = await Deno.stat(path);
              items.push({
                word: relative(dir, path) + (entry.isDirectory ? "/" : ""),
                action: {
                  path: path,
                  isDirectory: entry.isDirectory,
                  isLink: entry.isSymlink,
                },
                status: {
                  size: stat.size,
                  time: stat.mtime?.getTime(),
                },
                isTree: entry.isDirectory,
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
                  path: join(dir, args.input),
                },
              }],
            );
          }
        } else {
          controller.enqueue(
            await tree(resolve(dir, dir)),
          );
        }

        controller.close();
      },
    });
  }

  async checkUpdated(args: {
    denops: Denops;
    sourceOptions: SourceOptions;
  }): Promise<boolean> {
    let dir = args.sourceOptions.path;
    if (dir == "") {
      dir = await fn.getcwd(args.denops) as string;
    }

    if (!(await exists(dir))) {
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

  params(): Params {
    return {
      "new": false,
    };
  }
}

const exists = async (path: string) => {
  // Note: Deno.stat() may be failed
  try {
    const stat = await Deno.stat(path);
    if (stat.isDirectory || stat.isFile || stat.isSymlink) {
      return true;
    }
  } catch (_: unknown) {
    // Ignore stat exception
  }

  return false;
};
