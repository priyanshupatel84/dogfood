'use client'

import { useEffect, useMemo, useState } from 'react'

interface Assignment { id: string; status: string; submission: { title: string; team: { name: string }; track: { name: string } }; score?: { rawTotal: number } }

export default function JudgeDashboard() {
  const [eventId, setEventId] = useState('')
  const [judgeId, setJudgeId] = useState('')
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setEventId(params.get('eventId') ?? '')
    setJudgeId(params.get('judge') ?? '')
  }, [])
  useEffect(() => {
    if (!eventId) return
    fetch(`/api/judge/assignments?eventId=${encodeURIComponent(eventId)}`)
      .then(async (response) => { if (!response.ok) throw new Error('Unable to load assignments'); return response.json() })
      .then((data) => setAssignments(data.assignments ?? []))
      .catch((reason: Error) => setError(reason.message))
  }, [eventId])
  const completed = useMemo(() => assignments.filter((item) => item.status === 'COMPLETED').length, [assignments])
  const progress = assignments.length ? Math.round((completed / assignments.length) * 100) : 0

  return <main className="min-h-screen bg-[#f7f8fb] px-6 py-10 text-[#181a20] md:px-12"><div className="mx-auto max-w-5xl"><header className="mb-8"><p className="text-xs font-bold uppercase tracking-[.16em] text-[#635bdb]">Dogfood 2026 / Judge workspace</p><h1 className="mt-3 text-4xl font-bold tracking-tight">Your evaluations</h1><p className="mt-2 text-sm text-[#737783]">Review assigned projects and keep your judging progress on track.</p></header><section className="grid gap-4 sm:grid-cols-3"><Metric label="Assigned" value={assignments.length} /><Metric label="Completed" value={completed} /><Metric label="Progress" value={`${progress}%`} /></section>{error && <p role="alert" className="mt-6 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}<section className="mt-8 rounded-2xl border border-[#e6e7ed] bg-white p-5"><h2 className="text-lg font-bold">Assigned projects</h2><div className="mt-4 divide-y divide-[#eef0f4]">{assignments.length === 0 && !error ? <p className="py-8 text-sm text-[#858894]">No assignments found for this event.</p> : assignments.map((item) => <article key={item.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="font-semibold">{item.submission.title}</h3><p className="mt-1 text-xs text-[#858894]">{item.submission.team.name} · {item.submission.track.name}</p></div><span className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${item.status === 'COMPLETED' ? 'bg-[#effaf4] text-[#329b69]' : 'bg-[#fff4df] text-[#b2761b]'}`}>{item.status === 'COMPLETED' ? `Scored${item.score ? ` · ${item.score.rawTotal}` : ''}` : 'Pending'}</span></article>)}</div></section>{judgeId && <p className="mt-4 text-xs text-[#9a9da8]">Signed-in judge: {judgeId}</p>}</div></main>
}
function Metric({ label, value }: { label: string; value: string | number }) { return <div className="rounded-2xl border border-[#e6e7ed] bg-white p-5"><p className="text-xs font-semibold text-[#858894]">{label}</p><p className="mt-2 text-3xl font-bold">{value}</p></div> }
