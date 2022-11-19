# ddu-source-file

File source for ddu.vim

This source collects files in the path.

## Required

### denops.vim

https://github.com/vim-denops/denops.vim

### ddu.vim

https://github.com/Shougo/ddu.vim

### ddu-kind-file

https://github.com/Shougo/ddu-kind-file

## Configuration

```vim
call ddu#start(#{ sources: [#{ name: 'file' }] })

" Change base path.
call ddu#custom#patch_global('sourceOptions', #{
      \   file: #{ path: expand("~") },
      \ })
```
