# ddu-source-file

File source for ddu.vim

This source collects files in the path.

## Required

### denops.vim

https://github.com/vim-denops/denops.vim

### ddu.vim

https://github.com/Shougo/ddu.vim

## Configuration

```vim
" Change source options.
call ddu#custom#patch_global('sourceParams', {
      \ 'file': {'path': expand("~")},
      \ })

" Use file source.
call ddu#start([{'name': 'file'}])
```
