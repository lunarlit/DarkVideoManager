import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useLibraryStore } from '../store/libraryStore'
import { libraryApi, videosApi } from '../api'
import { useVideoMetadataOptions } from '../api/useVideos'
import ImportDialog from '../components/library/ImportDialog'

const OUTSIDE_KEY = '__outside__'

function splitPath(path) {
  return path.split(/[\\/]+/).filter(Boolean)
}
function joinPath(base, part) {
  const sep = base.includes('/') && !base.includes('\\') ? '/' : '\\'
  return base.replace(/[\\/]+$/, '') + sep + part
}
function lower(path) {
  return path.replace(/[\\/]+$/, '').toLowerCase()
}
function isInside(path, root) {
  const p = lower(path)
  const r = lower(root)
  return p === r || p.startsWith(r + '\\') || p.startsWith(r + '/')
}

function makeNode(name, path) {
  return { name, path, direct: 0, total: 0, children: new Map() }
}

/** Build one tree per registered root from the folders that hold videos. */
function buildTrees(roots, dirs) {
  const trees = roots.map((root) => makeNode(root, root))
  const outside = makeNode('등록 폴더 밖의 영상', OUTSIDE_KEY)
  for (const dir of dirs) {
    const root = trees
      .filter((tree) => isInside(dir.path, tree.path))
      .sort((a, b) => b.path.length - a.path.length)[0]
    if (!root) {
      const node = makeNode(dir.path, dir.path)
      node.direct = node.total = dir.count
      outside.children.set(lower(dir.path), node)
      outside.total += dir.count
      continue
    }
    const rest = splitPath(dir.path.slice(root.path.replace(/[\\/]+$/, '').length))
    let node = root
    node.total += dir.count
    for (const part of rest) {
      const key = part.toLowerCase()
      if (!node.children.has(key)) node.children.set(key, makeNode(part, joinPath(node.path, part)))
      node = node.children.get(key)
      node.total += dir.count
    }
    node.direct += dir.count
  }
  return outside.children.size ? [...trees, outside] : trees
}

function sortedChildren(node) {
  return [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'))
}

function FolderRow({ node, depth, expanded, onToggle, onOpenVideos, onReveal, editor }) {
  const hasChildren = node.children.size > 0
  const isOpen = expanded.has(node.path)
  const isOutsideGroup = node.path === OUTSIDE_KEY
  return (
    <>
      <div
        className="group flex items-center gap-1 rounded px-2 py-1 hover:bg-zinc-800/70"
        style={{ paddingLeft: 8 + depth * 18 }}
      >
        <button
          type="button"
          aria-label={isOpen ? `${node.name} 접기` : `${node.name} 펼치기`}
          onClick={() => onToggle(node.path)}
          disabled={!hasChildren}
          className="flex h-5 w-5 shrink-0 items-center justify-center text-zinc-500 hover:text-zinc-200 disabled:invisible"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-90' : ''}`}
            aria-hidden="true"
          >
            <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          className={`h-4 w-4 shrink-0 ${depth === 0 ? 'text-indigo-400' : 'text-amber-300/80'}`}
          aria-hidden="true"
        >
          <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z" />
        </svg>
        <button
          type="button"
          disabled={isOutsideGroup}
          onClick={() => onOpenVideos(node.path)}
          title={isOutsideGroup ? undefined : `${node.path}\n누르면 이 폴더의 영상만 보여 줍니다`}
          className="min-w-0 flex-1 truncate text-left text-sm text-zinc-200 hover:text-white hover:underline disabled:no-underline"
        >
          {node.name}
        </button>
        <span className="shrink-0 text-xs tabular-nums text-zinc-500">
          {node.total.toLocaleString()}편
          {hasChildren && node.direct > 0 ? ` (이 폴더 ${node.direct})` : ''}
        </span>
        {!isOutsideGroup && (
          <button
            type="button"
            onClick={() => editor.open(node.path)}
            className="ml-2 shrink-0 rounded px-2 py-0.5 text-xs text-zinc-500 opacity-0 hover:bg-zinc-700 hover:text-zinc-100 focus:opacity-100 group-hover:opacity-100"
          >
            카테고리 설정
          </button>
        )}
        {!isOutsideGroup && (
          <button
            type="button"
            onClick={() => onReveal(node.path)}
            className="ml-2 shrink-0 rounded px-2 py-0.5 text-xs text-zinc-500 opacity-0 hover:bg-zinc-700 hover:text-zinc-100 focus:opacity-100 group-hover:opacity-100"
          >
            탐색기에서 열기
          </button>
        )}
      </div>
      {editor.path === node.path && (
        <CategoryEditor node={node} depth={depth} editor={editor} />
      )}
      {isOpen &&
        sortedChildren(node).map((child) => (
          <FolderRow
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            onOpenVideos={onOpenVideos}
            onReveal={onReveal}
            editor={editor}
          />
        ))}
    </>
  )
}

export default function FoldersPage() {
  const activeLibraryId = useLibraryStore((s) => s.activeLibraryId)
  const openedLibraryId = useLibraryStore((s) => s.openedLibraryId)
  const getMetadataFilters = useLibraryStore((s) => s.getMetadataFilters)
  const setMetadataFilters = useLibraryStore((s) => s.setMetadataFilters)
  const setSelectedVideoId = useLibraryStore((s) => s.setSelectedVideoId)
  const navigate = useNavigate()
  const ready = !!activeLibraryId && openedLibraryId === activeLibraryId
  const [expanded, setExpanded] = React.useState(() => new Set())
  const [revealError, setRevealError] = React.useState(null)
  const queryClient = useQueryClient()
  const metadataOptions = useVideoMetadataOptions(activeLibraryId ?? '', false, ready)
  const [editingPath, setEditingPath] = React.useState(null)
  const [showImport, setShowImport] = React.useState(false)
  const [categoryMessage, setCategoryMessage] = React.useState(null)
  const setFolderCategory = useMutation({
    mutationFn: async ({ folder, category }) => {
      const res = await videosApi.setFolderCategory(activeLibraryId, folder, category)
      if (!res.ok) throw new Error(res.error)
      return res.value
    },
    onSuccess: (count, { folder, category }) => {
      const name = folder.split(/[\\/]/).filter(Boolean).pop()
      setCategoryMessage(
        category
          ? `${name} 폴더의 영상 ${count}개를 '${category}' 카테고리로 설정했습니다.`
          : `${name} 폴더의 영상 ${count}개를 미분류로 바꿨습니다.`,
      )
      setEditingPath(null)
      queryClient.invalidateQueries({ queryKey: ['videos', activeLibraryId] })
      queryClient.invalidateQueries({ queryKey: ['video', activeLibraryId] })
      queryClient.invalidateQueries({ queryKey: ['video-metadata-options', activeLibraryId] })
    },
  })
  const editor = {
    path: editingPath,
    categories: metadataOptions.data?.categories ?? [],
    isSaving: setFolderCategory.isPending,
    error: setFolderCategory.error?.message ?? null,
    open: (path) => {
      setFolderCategory.reset()
      setCategoryMessage(null)
      setEditingPath(path)
    },
    close: () => setEditingPath(null),
    apply: (folder, category) => setFolderCategory.mutate({ folder, category: category.trim() }),
  }

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['folder-tree', activeLibraryId],
    queryFn: async () => {
      const res = await libraryApi.folderTree(activeLibraryId)
      if (!res.ok) throw new Error(res.error)
      return res.value
    },
    enabled: ready,
    staleTime: 30_000,
  })
  const trees = React.useMemo(() => (data ? buildTrees(data.roots, data.dirs) : []), [data])

  // Registered roots start expanded.
  React.useEffect(() => {
    if (data) setExpanded(new Set(data.roots))
  }, [data])

  function toggle(path) {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }
  function openVideos(path) {
    if (!activeLibraryId) return
    setSelectedVideoId(null)
    setMetadataFilters(activeLibraryId, { ...getMetadataFilters(activeLibraryId), folder: path })
    navigate('/')
  }
  async function reveal(path) {
    setRevealError(null)
    const res = await libraryApi.openFolder(activeLibraryId, path)
    if (!res.ok) setRevealError(res.error)
  }

  if (!ready)
    return (
      <div className="flex flex-1 items-center justify-center text-zinc-500">
        라이브러리를 여는 중입니다...
      </div>
    )
  if (isLoading)
    return (
      <div className="flex flex-1 items-center justify-center text-zinc-500">
        폴더 목록을 불러오는 중입니다...
      </div>
    )
  if (isError)
    return (
      <div className="flex flex-1 items-center justify-center gap-3 text-red-300">
        폴더 목록을 불러오지 못했습니다.
        <button onClick={() => void refetch()} className="underline">
          다시 시도
        </button>
      </div>
    )

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-zinc-950 p-4">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-lg font-semibold text-zinc-100">폴더</h2>
        <span className="text-sm text-zinc-500">등록 폴더 {data.roots.length}개</span>
        <button
          type="button"
          onClick={() => setExpanded(new Set(collectPaths(trees)))}
          className="ml-auto rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        >
          모두 펼치기
        </button>
        <button
          type="button"
          onClick={() => setExpanded(new Set())}
          className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        >
          모두 접기
        </button>
        <button
          type="button"
          onClick={() => setShowImport(true)}
          className="rounded bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-500"
        >
          폴더 가져오기
        </button>
      </div>
      {categoryMessage && (
        <p role="status" className="mb-2 text-xs text-indigo-200">
          {categoryMessage}
        </p>
      )}
      {revealError && (
        <p role="alert" className="mb-2 text-xs text-amber-300">
          {revealError}
        </p>
      )}
      {trees.length === 0 ? (
        <p className="text-sm text-zinc-500">
          등록된 폴더가 없습니다. 오른쪽 위의 폴더 가져오기로 추가하세요.
        </p>
      ) : (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 py-1">
          {trees.map((tree) => (
            <FolderRow
              key={tree.path}
              node={tree}
              depth={0}
              expanded={expanded}
              onToggle={toggle}
              onOpenVideos={openVideos}
              onReveal={(path) => void reveal(path)}
              editor={editor}
            />
          ))}
        </div>
      )}
      {showImport && (
        <ImportDialog
          libraryId={activeLibraryId}
          mode="folder"
          onClose={() => {
            setShowImport(false)
            queryClient.invalidateQueries({ queryKey: ['folder-tree', activeLibraryId] })
            queryClient.invalidateQueries({ queryKey: ['videos', activeLibraryId] })
            queryClient.invalidateQueries({ queryKey: ['video-metadata-options', activeLibraryId] })
            queryClient.invalidateQueries({ queryKey: ['performer-counts', activeLibraryId] })
          }}
        />
      )}
    </div>
  )
}

function collectPaths(nodes) {
  const out = []
  const walk = (node) => {
    if (node.children.size) out.push(node.path)
    node.children.forEach(walk)
  }
  nodes.forEach(walk)
  return out
}

function CategoryEditor({ node, depth, editor }) {
  const [value, setValue] = React.useState('')
  const listId = React.useId()
  const trimmed = value.trim()
  function submit(event) {
    event.preventDefault()
    if (editor.isSaving) return
    editor.apply(node.path, trimmed)
  }
  return (
    <form
      onSubmit={submit}
      className="my-1 flex flex-wrap items-center gap-2 rounded border border-zinc-700 bg-zinc-950/60 py-2 pr-2 text-xs"
      style={{ marginLeft: 8 + depth * 18 + 28, paddingLeft: 10 }}
    >
      <span className="text-zinc-400">
        이 폴더(하위 포함) 영상 {node.total.toLocaleString()}개의 카테고리
      </span>
      <input
        autoFocus
        list={listId}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') editor.close()
        }}
        placeholder="카테고리 입력 또는 선택"
        aria-label="설정할 카테고리"
        maxLength={200}
        className="w-48 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-100 outline-hidden focus:ring-1 focus:ring-indigo-500"
      />
      <datalist id={listId}>
        {editor.categories.map((category) => (
          <option key={category} value={category} />
        ))}
      </datalist>
      <button
        type="submit"
        disabled={editor.isSaving}
        className="rounded bg-indigo-600 px-3 py-1 text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {editor.isSaving ? '적용 중...' : trimmed ? '적용' : '미분류로 적용'}
      </button>
      <button
        type="button"
        onClick={editor.close}
        className="rounded px-2 py-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
      >
        취소
      </button>
      {editor.error && (
        <span role="alert" className="w-full text-amber-300">
          {editor.error}
        </span>
      )}
    </form>
  )
}
