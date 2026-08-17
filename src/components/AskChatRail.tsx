import { DeleteOutlined, MessageOutlined, PlusOutlined } from '@ant-design/icons'
import { App, Button, Popconfirm } from 'antd'
import type { AskChat } from '../data/askChats'
import { CHATS_KEPT } from '../data/askChats'
import '../pages/AskPage.css'

const day = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString()
}

/**
 * **New chat**, and this session's history.
 *
 * Its own component rather than a branch in `AskPage`, for the reason the requirements panel
 * is: a list rendered inside a page whose state decides whether it appears cannot be asserted
 * on — `renderToString` renders whatever the initial state says, and every check about the
 * rows would pass over nothing.
 *
 * **The history is this session's, in this browser, for this signed-in address**, and the
 * footnote says so in those words. It is `sessionStorage`, so closing the tab ends it and
 * nothing is posted anywhere — the same honesty the studio's in-memory decisions get. A rail
 * that looked like an archive would be promising a server-side one that does not exist.
 */
export default function AskChatRail({
  chats,
  activeChatId,
  asking,
  onNewChat,
  onOpen,
  onDelete,
  onClear,
}: {
  chats: AskChat[]
  activeChatId: string | null
  /** A question in flight: switching threads mid-answer would strand it. */
  asking: boolean
  onNewChat: () => void
  onOpen: (chatId: string) => void
  onDelete: (chatId: string) => void
  onClear: () => void
}) {
  const { message } = App.useApp()

  /* One guard for every control, because the reason is the same each time. */
  const busy = () => {
    if (!asking) return false
    message.warning('An answer is still streaming — let it land before switching chats.')
    return true
  }

  return (
    <aside className="ask-rail" aria-label="Chats">
      <Button
        block
        icon={<PlusOutlined />}
        onClick={() => {
          if (busy()) return
          onNewChat()
        }}
        /* Not `type="primary"`: asking is the page's primary act, and two primary buttons
           on one screen argue about which one that is. */
        className="ask-rail-new"
      >
        New chat
      </Button>

      <div className="ask-rail-title">
        Chat history
        {chats.length > 0 ? <span className="ask-rail-count">{chats.length}</span> : null}
      </div>

      {chats.length === 0 ? (
        /* Not antd's `Empty`: this is a panel before a step has been taken, and it says
           which step. */
        <p className="ask-rail-empty">
          No chats yet. Ask a question and this thread appears here.
        </p>
      ) : (
        <ul className="ask-rail-list">
          {chats.map((chat) => (
            <li key={chat.chatId}>
              <button
                type="button"
                className={`ask-rail-item${chat.chatId === activeChatId ? ' is-on' : ''}`}
                aria-current={chat.chatId === activeChatId}
                onClick={() => {
                  if (busy()) return
                  onOpen(chat.chatId)
                }}
              >
                <MessageOutlined aria-hidden="true" />
                <span className="ask-rail-item-text">
                  <span className="ask-rail-item-title">{chat.title}</span>
                  {/* What it was asked *of*, and how much of it there is: a thread's
                      answers belong to one graph, and reopening it selects that graph. */}
                  <span className="ask-rail-item-meta">
                    {`${chat.graphName} · ${chat.turns.length} question${chat.turns.length === 1 ? '' : 's'} · ${day(chat.updatedAt)}`}
                  </span>
                </span>
              </button>
              <Popconfirm
                title="Delete this chat?"
                description="It leaves this session's history. Nothing was stored anywhere else."
                okText="Delete"
                cancelText="Keep"
                onConfirm={() => {
                  if (busy()) return
                  onDelete(chat.chatId)
                }}
              >
                <button
                  type="button"
                  className="ask-rail-del"
                  aria-label={`Delete chat: ${chat.title}`}
                >
                  <DeleteOutlined aria-hidden="true" />
                </button>
              </Popconfirm>
            </li>
          ))}
        </ul>
      )}

      {chats.length > 0 ? (
        <Popconfirm
          title="Clear this session's chats?"
          description="Every thread above goes. There is no copy on the server to restore from."
          okText="Clear"
          cancelText="Keep"
          onConfirm={() => {
            if (busy()) return
            onClear()
          }}
        >
          <Button size="small" block className="ask-rail-clear">
            Clear history
          </Button>
        </Popconfirm>
      ) : null}

      {/* The one thing a reader has to know about this list, and it is a limit, not a
          feature: it lives in the tab. Said once, at the bottom, where a footnote belongs. */}
      <p className="ask-rail-note">
        {`Kept in this browser tab for this signed-in address — the last ${CHATS_KEPT} chats. Closing the tab ends the session; nothing is stored on the server.`}
      </p>
    </aside>
  )
}
