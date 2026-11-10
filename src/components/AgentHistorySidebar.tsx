import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AgentConversation } from '../types'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { getAgentConversationTaskIds, getConversationSearchText, groupAgentConversationHistory } from '../lib/agentConversationState'
import { removeMultipleTasks, useStore } from '../store'
import { CloseIcon, EditIcon, PlusIcon, SidebarLeftIcon, TrashIcon } from './icons'
import { TooltipButton } from './TooltipButton'

type Props = {
  conversations: AgentConversation[]
  activeId: string | null
  loading: boolean
  drawer: boolean
  onClose: () => void
  onCreate: () => void
  onSelect: (id: string) => void
}

const iconButton = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-black/[0.06] hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/50 dark:text-gray-400 dark:hover:bg-white/[0.08] dark:hover:text-gray-100'
const menuButton = 'flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/50'

export default function AgentHistorySidebar({ conversations, activeId, loading, drawer, onClose, onCreate, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null)
  const [menu, setMenu] = useState<{ id: string; button: HTMLButtonElement; left: number; top: number } | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const generatingTitles = useStore((s) => s.agentGeneratingTitleIds)
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase())
  const deferredConversations = useDeferredValue(conversations)
  const groups = useMemo(() => {
    const filtered = deferredQuery
      ? deferredConversations.filter((item) => getConversationSearchText(item).includes(deferredQuery))
      : deferredConversations
    return groupAgentConversationHistory(filtered)
  }, [deferredConversations, deferredQuery])
  const menuConversation = menu ? conversations.find((item) => item.id === menu.id) : undefined

  useCloseOnEscape(drawer, onClose)
  useCloseOnEscape(Boolean(menuConversation), () => {
    menu?.button.focus({ preventScroll: true })
    setMenu(null)
  })
  usePreventBackgroundScroll(drawer, panelRef)

  useEffect(() => {
    if (drawer) panelRef.current?.focus({ preventScroll: true })
  }, [drawer])

  useEffect(() => {
    if (!menu) return
    const dismiss = () => setMenu(null)
    const handleOutside = (event: Event) => {
      if (!(event.target instanceof Node)) return
      if (menuRef.current?.contains(event.target) || menu.button.contains(event.target)) return
      dismiss()
    }
    document.addEventListener('pointerdown', handleOutside, true)
    document.addEventListener('focusin', handleOutside, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      document.removeEventListener('pointerdown', handleOutside, true)
      document.removeEventListener('focusin', handleOutside, true)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [menu])

  const requestDelete = (conversation: AgentConversation) => {
    const state = useStore.getState()
    const relatedTaskIds = getAgentConversationTaskIds(conversation, state.tasks)
    const relatedTasks = new Set(relatedTaskIds)
    const generatedImageCount = new Set(state.tasks
      .filter((task) => relatedTasks.has(task.id))
      .flatMap((task) => task.outputImages ?? [])).size

    state.setConfirmDialog({
      title: '删除对话',
      message: '确定要删除这个 Agent 对话吗？',
      checkbox: relatedTaskIds.length > 0
        ? {
            label: generatedImageCount > 0
              ? `同时删除对话中生成的图片（${generatedImageCount} 张）和关联任务`
              : `同时删除对话关联任务（${relatedTaskIds.length} 个）`,
            tone: 'danger',
          }
        : undefined,
      action: async (deleteGeneratedImages = false) => {
        if (deleteGeneratedImages && relatedTaskIds.length > 0) await removeMultipleTasks(relatedTaskIds)
        useStore.getState().deleteAgentConversation(conversation.id)
      },
    })
  }

  return (
    <>
      {drawer && <div aria-hidden="true" className="fixed inset-0 z-50 bg-black/40" onClick={onClose} />}
      <aside
        id="agent-history-sidebar"
        ref={panelRef}
        tabIndex={drawer ? -1 : undefined}
        role={drawer ? 'dialog' : undefined}
        aria-modal={drawer || undefined}
        aria-labelledby="agent-history-heading"
        className={`flex min-h-0 shrink-0 flex-col border-r border-gray-200/90 bg-gray-50 text-gray-800 outline-none dark:border-white/[0.08] dark:bg-[#18191d] dark:text-gray-100 ${drawer
          ? 'safe-area-top fixed inset-y-0 left-0 z-[60] w-[min(20rem,86vw)] shadow-2xl'
          : 'sticky top-[var(--header-height)] h-[calc(100dvh-var(--header-height))] w-[var(--agent-history-width)] self-start'}`}
      >
        <div className="shrink-0 px-3 pb-3 pt-2">
          <div className="mb-2 flex items-center justify-between gap-2 pl-2">
            <h2 id="agent-history-heading" className="text-sm font-semibold">历史对话</h2>
            <TooltipButton tooltip={drawer ? '关闭历史对话' : '收起历史对话'} className={iconButton} onClick={onClose}>
              {drawer ? <CloseIcon className="h-4 w-4" /> : <SidebarLeftIcon className="h-4 w-4" />}
            </TooltipButton>
          </div>
          <button
            type="button"
            onClick={onCreate}
            className="flex min-h-10 w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 dark:border-white/[0.09] dark:bg-white/[0.05] dark:hover:bg-white/[0.09]"
          >
            <PlusIcon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            新建对话
          </button>
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-transparent bg-black/[0.04] pl-2.5 pr-1 focus-within:border-blue-500/50 focus-within:bg-white dark:bg-white/[0.06] dark:focus-within:bg-white/[0.08]">
            <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8">
              <circle cx="11" cy="11" r="6" />
              <path strokeLinecap="round" d="m16 16 4 4" />
            </svg>
            <input
              ref={searchRef}
              type="search"
              aria-label="搜索对话"
              placeholder="搜索对话"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-9 min-w-0 flex-1 appearance-none bg-transparent text-sm outline-none placeholder:text-gray-500 [&::-webkit-search-cancel-button]:hidden dark:placeholder:text-gray-400"
            />
            {query && <TooltipButton tooltip="清空搜索" className={`${iconButton} h-8 w-8`} onClick={() => {
              setQuery('')
              searchRef.current?.focus()
            }}>
              <CloseIcon className="h-3.5 w-3.5" />
            </TooltipButton>}
          </div>
        </div>

        <nav aria-label="对话列表" className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 pb-5">
          {groups.length === 0 && (
            <p className="px-2 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              {loading ? '正在读取对话…' : deferredQuery ? '没有找到匹配的对话' : '还没有历史对话'}
            </p>
          )}
          {groups.map((group) => (
            <section key={group.label}>
              <h3 className="mb-1 px-2 text-xs font-medium text-gray-500 dark:text-gray-400">{group.label}</h3>
              <ul className="space-y-0.5">
                {group.conversations.map((item) => {
                  const active = item.id === activeId
                  const running = item.rounds.some((round) => round.status === 'running')
                  const title = item.title || '新对话'
                  if (editing?.id === item.id) {
                    return (
                      <li key={item.id}>
                        <form className="flex min-h-10 items-center gap-1" onSubmit={(e) => {
                          e.preventDefault()
                          const nextTitle = editing.title.trim()
                          if (nextTitle) useStore.getState().renameAgentConversation(item.id, nextTitle)
                          setEditing(null)
                        }}>
                          <input
                            aria-label="对话标题"
                            value={editing.title}
                            onChange={(e) => setEditing({ id: item.id, title: e.target.value })}
                            onFocus={(e) => e.currentTarget.select()}
                            onKeyDown={(e) => {
                              if (e.key !== 'Escape') return
                              e.preventDefault()
                              e.stopPropagation()
                              setEditing(null)
                            }}
                            autoFocus
                            className="h-9 min-w-0 flex-1 rounded-lg border border-blue-500/50 bg-white px-2 text-sm outline-none dark:bg-white/[0.08]"
                          />
                          <button type="submit" className="rounded-md px-2 py-2 text-xs font-medium text-blue-700 hover:bg-blue-500/10 dark:text-blue-300">保存</button>
                          <TooltipButton tooltip="取消重命名" className={`${iconButton} w-8`} onClick={() => setEditing(null)}>
                            <CloseIcon className="h-3.5 w-3.5" />
                          </TooltipButton>
                        </form>
                      </li>
                    )
                  }
                  return (
                    <li key={item.id} className={`group flex min-w-0 items-center gap-0.5 rounded-lg pr-0.5 transition-colors ${active
                      ? 'bg-blue-500/[0.11] dark:bg-blue-400/[0.15]'
                      : 'hover:bg-black/[0.05] focus-within:bg-black/[0.05] dark:hover:bg-white/[0.05] dark:focus-within:bg-white/[0.05]'}`}>
                      <button
                        type="button"
                        aria-current={active ? 'page' : undefined}
                        onClick={() => { setEditing(null); onSelect(item.id) }}
                        className={`flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/50 ${active ? 'font-semibold text-blue-800 dark:text-blue-200' : ''}`}
                      >
                        <span className="truncate">{title}</span>
                        {running && <span aria-label="生成中" className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-blue-500" />}
                      </button>
                      <button
                        type="button"
                        aria-label={`${title}的对话选项`}
                        aria-expanded={menu?.id === item.id}
                        aria-controls={menu?.id === item.id ? 'agent-history-actions' : undefined}
                        className={`${iconButton} w-8 ${!drawer && !active && menu?.id !== item.id ? 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100' : ''}`}
                        onClick={(e) => {
                          if (menu?.id === item.id) {
                            setMenu(null)
                            return
                          }
                          const button = e.currentTarget
                          const rect = button.getBoundingClientRect()
                          setMenu({
                            id: item.id,
                            button,
                            left: Math.max(8, rect.right - 152),
                            top: rect.bottom + 88 < window.innerHeight ? rect.bottom + 4 : Math.max(8, rect.top - 84),
                          })
                        }}
                      >
                        <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                          <circle cx="5" cy="12" r="1.7" />
                          <circle cx="12" cy="12" r="1.7" />
                          <circle cx="19" cy="12" r="1.7" />
                        </svg>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </nav>
      </aside>

      {menu && menuConversation && createPortal(
        <div
          id="agent-history-actions"
          ref={menuRef}
          role="group"
          aria-label="对话操作"
          style={{ left: menu.left, top: menu.top }}
          className="fixed z-[65] w-[152px] rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-white/[0.10] dark:bg-gray-900"
        >
          <button
            type="button"
            autoFocus={!generatingTitles[menu.id]}
            disabled={Boolean(generatingTitles[menu.id])}
            className={`${menuButton} text-gray-700 hover:bg-black/[0.05] disabled:opacity-50 dark:text-gray-200 dark:hover:bg-white/[0.06]`}
            onClick={() => {
              setEditing({ id: menu.id, title: menuConversation.title })
              setMenu(null)
            }}
          >
            <EditIcon className="h-4 w-4" />
            重命名
          </button>
          <button
            type="button"
            autoFocus={Boolean(generatingTitles[menu.id])}
            className={`${menuButton} text-red-600 hover:bg-red-500/10 dark:text-red-400`}
            onClick={() => {
              setMenu(null)
              requestDelete(menuConversation)
            }}
          >
            <TrashIcon className="h-4 w-4" />
            删除对话
          </button>
        </div>,
        document.body,
      )}
    </>
  )
}
