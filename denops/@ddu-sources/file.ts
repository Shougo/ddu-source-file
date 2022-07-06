import {
  BaseSource,
  Item,
  SourceOptions,
} from "https://deno.land/x/ddu_vim@v1.8.6/types.ts";
import { Denops, fn } from "https://deno.land/x/ddu_vim@v1.8.6/deps.ts";
import { join, resolve } from "https://deno.land/std@0.147.0/path/mod.ts";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.3.0/file.ts";
import { relative } from "https://deno.land/std@0.147.0/path/mod.ts";

type Params = {
  "new": boolean;
};

export class Source extends BaseSource<Params> {
  kind = "file";
  prevMtime = -1;

  gather(args: {
    denops: Denops;
    sourceOptions: SourceOptions;
    sourceParams: Params;
    input: string;
  }): ReadableStream<Item<ActionData>[]> {
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
                },
                status: {
                  size: stat.size,
                  time: stat.mtime,
                },
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

        const stat = await Deno.stat(dir);
        this.prevMtime = stat.mtime;
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
      return -1;
    }

    const stat = await Deno.stat(dir);
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
