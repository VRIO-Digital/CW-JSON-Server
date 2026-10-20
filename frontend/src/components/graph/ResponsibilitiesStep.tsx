import { DownOutlined, FileTextOutlined, PlusOutlined, ReloadOutlined, RightOutlined, UploadOutlined } from '@ant-design/icons'
import { Button, Checkbox, Input, Space, Spin, Tag, Upload } from 'antd'
import { useEffect } from 'react'
import { OUT_REASONS } from '../../data/roleLibrary'
import { industryName } from '../../data/roleBrief'
import type { RoleDraft } from './useRoleDraft'
import '../../pages/NewGraphPage.css'

/**
 * Step 2 of the New Role wizard — what the role is responsible for. New: the *Domain* step it
 * follows used to be the only thing said about a graph's subject, and a role is defined by what it
 * does, so this is where a reader says it.
 *
 * Drafted from the role library the moment the step opens (nothing to ask for first), as a list of
 * responsibility areas, each with its tasks. Keep what applies, take out what is done elsewhere —
 * with a reason, because "not ours" and "not yet" are different statements — and open one to change
 * its tasks. A job description can be added: only its name travels, and what reading it "turns up"
 * is the role library's own list of suggestions, so each one quotes the page it came from and is
 * accepted or dismissed by hand.
 */
export default function ResponsibilitiesStep({ draft }: { draft: RoleDraft }) {
  const { role, ready, drafting, areas, out, dropped, openArea, jd } = draft

  /* Opening the step drafts straight away — there is nothing to ask first. */
  useEffect(() => {
    if (role && !ready && !drafting) draft.draftResponsibilities()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role?.id, ready, drafting])

  if (!role) return null
  const findings = role.jd.findings

  return (
    <div>
      <div className="nr-resp-head">
        <div>
          <div className="nr-resp-title">What the {role.name} is responsible for</div>
          <div className="ng-help">
            Drafted from the role library for {industryName(draft.industry).toLowerCase()} utilities. Keep what applies,
            take out what is done elsewhere, and open one to change its tasks.
          </div>
        </div>
        <Space size={8}>
          <Upload
            showUploadList={false}
            disabled={!ready || Boolean(jd?.reading)}
            beforeUpload={(file) => {
              draft.readJobDescription(file.name)
              return Upload.LIST_IGNORE
            }}
          >
            <Button icon={<UploadOutlined />} disabled={!ready || Boolean(jd?.reading)}>
              Add job description
            </Button>
          </Upload>
          <Button icon={<ReloadOutlined />} disabled={drafting} onClick={draft.draftResponsibilities}>
            Draft again
          </Button>
        </Space>
      </div>

      {drafting ? (
        <div className="nr-jd">
          <Spin size="small" /> <span className="nr-dim">Drafting the responsibilities of a {role.name}…</span>
        </div>
      ) : null}

      {jd ? (
        <div className="nr-jd">
          <div className="nr-jd-head">
            <FileTextOutlined /> <b>{jd.file}</b>
            <span className="nr-dim">{jd.reading ? ' · reading' : ` · ${findings.length} suggestions`}</span>
          </div>
          {jd.reading ? (
            <div>
              <Spin size="small" /> <span className="nr-dim">Reading the job description…</span>
            </div>
          ) : (
            findings.map((f) => {
              const status = jd.status[f.id] ?? 'open'
              return (
                <div key={f.id} className={`nr-find is-${status}`}>
                  <div>
                    <div>{f.text}</div>
                    <div className="nr-quote">{f.quote}</div>
                  </div>
                  <div className="nr-find-acts">
                    {f.kind === 'confirm' ? (
                      <Tag color="green">Matches</Tag>
                    ) : status === 'open' ? (
                      <>
                        <Button size="small" type="primary" onClick={() => draft.decideFinding(f, true)}>
                          Accept
                        </Button>
                        <Button size="small" onClick={() => draft.decideFinding(f, false)}>
                          Dismiss
                        </Button>
                      </>
                    ) : (
                      <Tag>{status === 'accepted' ? 'Accepted' : 'Dismissed'}</Tag>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      ) : null}

      {ready ? (
        <div className="nr-areas">
          {areas.map((a) => {
            const keep = !out[a.id]
            const isOpen = openArea === a.id
            const off = dropped[a.id] ?? []
            return (
              <div key={a.id} className={`nr-area${keep ? '' : ' is-out'}`} data-area={a.id}>
                <div className="nr-area-row">
                  <Checkbox
                    checked={keep}
                    onChange={(e) => draft.setScope(a.id, e.target.checked)}
                    aria-label={`Keep ${a.name}`}
                  />
                  <button type="button" className="nr-area-name" onClick={() => draft.setOpenArea(isOpen ? null : a.id)}>
                    {isOpen ? <DownOutlined /> : <RightOutlined />}
                    <b>{a.name}</b>
                    <span className="nr-area-what">{a.what}</span>
                  </button>
                  <span className="nr-area-n">{keep ? `${a.tasks.length - off.length} tasks` : 'Out of scope'}</span>
                </div>
                {keep ? null : (
                  <div className="nr-reasons">
                    {OUT_REASONS.map((reason) => (
                      <button
                        key={reason}
                        type="button"
                        className={`nr-chip${out[a.id] === reason ? ' is-on' : ''}`}
                        onClick={() => draft.setReason(a.id, reason)}
                      >
                        {reason}
                      </button>
                    ))}
                  </div>
                )}
                {isOpen && keep ? (
                  <div className="nr-tasks">
                    {a.tasks.map((t) => (
                      <label key={t} className="nr-task">
                        <Checkbox checked={!off.includes(t)} onChange={(e) => draft.toggleTask(a.id, t, e.target.checked)} />
                        <span>{t}</span>
                      </label>
                    ))}
                    <div className="nr-task-add">
                      <Input
                        size="small"
                        placeholder="Add a task"
                        value={draft.newTask[a.id] ?? ''}
                        onChange={(e) => draft.setNewTask((prev) => ({ ...prev, [a.id]: e.target.value }))}
                        onPressEnter={() => draft.addTask(a.id)}
                      />
                      <Button size="small" icon={<PlusOutlined />} onClick={() => draft.addTask(a.id)}>
                        Add
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
          <div className="ng-help">
            {draft.inScope.length} of {areas.length} responsibilities in scope.
          </div>
        </div>
      ) : null}
    </div>
  )
}
