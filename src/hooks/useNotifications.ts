import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'

export interface AppNotification {
  id: string
  recipient_id: string | null
  kind: string
  title: string
  body: string | null
  link: string | null
  created_at: string
  read: boolean
}

/** The signed-in player's notifications (personal + broadcasts), kept live. */
export function useNotifications(limit = 50) {
  const { profile } = useAuth()
  const [items, setItems] = useState<AppNotification[]>([])

  const load = useCallback(async () => {
    if (!profile) return
    const [n, r] = await Promise.all([
      supabase.from('notifications').select('*').or(`recipient_id.is.null,recipient_id.eq.${profile.id}`).order('created_at', { ascending: false }).limit(limit),
      supabase.from('notification_reads').select('notification_id').eq('player_id', profile.id),
    ])
    const read = new Set((r.data ?? []).map((x) => x.notification_id as string))
    setItems(((n.data ?? []) as Omit<AppNotification, 'read'>[]).map((x) => ({ ...x, read: read.has(x.id) })))
  }, [profile, limit])

  useEffect(() => {
    void load()
    if (!profile) return
    const ch = supabase
      .channel(`notifications-${profile.id}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, () => void load())
      .subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [profile, load])

  const markRead = async (id: string) => {
    if (!profile) return
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, read: true } : x)))
    await supabase.from('notification_reads').upsert({ notification_id: id, player_id: profile.id }, { ignoreDuplicates: true })
  }
  const markAllRead = async () => {
    setItems((xs) => xs.map((x) => ({ ...x, read: true })))
    await supabase.rpc('mark_all_notifications_read')
  }

  return { items, unread: items.filter((x) => !x.read).length, markRead, markAllRead, reload: load }
}
