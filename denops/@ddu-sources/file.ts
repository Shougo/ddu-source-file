import {
  BaseSource,
  Item,
  SourceOptions,
} from "https://deno.land/x/ddu_vim@v1.2.0/types.ts";
import { Denops, fn } from "https://deno.land/x/ddu_vim@v1.2.0/deps.ts";
import { join, resolve } from "https://deno.land/std@0.128.0/path/mod.ts";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.3.0/file.ts";
import { relative } from "https://deno.land/std@0.128.0/path/mod.ts";

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
              items.push({
                word: relative(dir, path) + (entry.isDirectory ? "/" : ""),
                action: {
                  path: path,
                  isDirectory: entry.isDirectory,
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
      },
    });
  }

  params(): Params {
    return {
      "new": false,
    };
  }
}
