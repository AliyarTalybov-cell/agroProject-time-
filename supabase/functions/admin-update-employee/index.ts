import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

type EmployeeRole = 'worker' | 'manager'
type Payload = {
  accessToken?: string
  id: string
  fullName: string
  email: string
  phone?: string | null
  position?: string | null
  additionalInfo?: string | null
  role: EmployeeRole
  active: boolean
}

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  headers.set('access-control-allow-origin', '*')
  headers.set('access-control-allow-headers', 'authorization, x-client-info, apikey, content-type')
  headers.set('access-control-allow-methods', 'POST, OPTIONS')
  return new Response(JSON.stringify(data), { ...init, headers })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY')
  if (!url || !anonKey || !serviceRoleKey) {
    return json({ error: 'Missing env' }, { status: 500 })
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let body: Payload
  try {
    body = (await req.json()) as Payload
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization') ?? ''
  const bearerToken = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : ''
  const accessToken = body.accessToken ? String(body.accessToken) : ''
  const token = accessToken || bearerToken
  if (!token) return json({ error: 'Unauthorized' }, { status: 401 })

  const userClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: callerData, error: callerErr } = await userClient.auth.getUser(token)
  if (callerErr || !callerData?.user) {
    console.error('[admin-update-employee] 401 invalid token', callerErr)
    return json({ error: 'Unauthorized' }, { status: 401 })
  }
  const callerRole = (callerData.user.user_metadata as { role?: string } | null)?.role
  if (callerRole !== 'manager') {
    return json({ error: 'Forbidden' }, { status: 403 })
  }

  const id = String(body.id ?? '').trim()
  const fullName = String(body.fullName ?? '').trim()
  const email = String(body.email ?? '').trim().toLowerCase()
  const role = (body.role === 'manager' ? 'manager' : 'worker') as EmployeeRole
  const phone = body.phone != null ? String(body.phone).trim() || null : null
  const position = body.position != null ? String(body.position).trim() || null : null
  const additionalInfo = body.additionalInfo != null ? String(body.additionalInfo).trim() || null : null
  const active = Boolean(body.active)

  if (!id) return json({ error: 'id is required' }, { status: 400 })
  if (fullName.length < 2) return json({ error: 'fullName is required' }, { status: 400 })
  if (!email || !email.includes('@')) return json({ error: 'email is required' }, { status: 400 })

  const now = new Date().toISOString()

  // Update Auth user metadata (email change is optional and may fail depending on settings)
  const { error: authErr } = await admin.auth.admin.updateUserById(id, {
    email,
    user_metadata: {
      full_name: fullName,
      role,
      phone,
      position,
      additional_info: additionalInfo,
      active,
    },
  })
  if (authErr) {
    // Continue: we still can update profiles table
    console.error('auth update error', authErr)
  }

  const { error: profileErr } = await admin.from('profiles').upsert(
    {
      id,
      email,
      display_name: fullName,
      role,
      active,
      phone,
      position,
      additional_info: additionalInfo,
      updated_at: now,
    },
    { onConflict: 'id' },
  )
  if (profileErr) return json({ error: profileErr.message }, { status: 400 })

  return json({ ok: true })
})

