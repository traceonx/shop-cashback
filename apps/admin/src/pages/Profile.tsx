import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CloudUpload, IdCard, KeyRound, LockKeyhole, RotateCcw, Save, User } from 'lucide-react'
import { api, auth } from '../lib/api'
import { errorText, type Notify } from '../lib/format'
import { compressAvatar, setProfile, useProfile, type Profile as ProfileData } from '../lib/profile'
import { UserAvatar } from '../layout/UserAvatar'
import { Alert, Button, Card, CardBody, CardHeader, Loading, TextField } from '../ui'

const MAX_SIZE = 800 * 1024

/** 个人信息：头像（上传 / 重置为默认）、昵称、修改密码 */
export function Profile({ notify }: { notify: Notify }) {
  const profile = useProfile()
  const file = useRef<HTMLInputElement>(null)
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [current, setCurrent] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (profile) setNickname(profile.nickname)
  }, [profile?.id])

  const saveAvatar = async (avatar: string | null) => {
    setUploading(true)
    setError('')
    try {
      setProfile(await api<ProfileData>('/auth/profile', { method: 'PUT', body: JSON.stringify({ avatar }) }))
      notify(avatar ? '头像已更新' : '已恢复默认头像')
    } catch (e) {
      setError(errorText(e))
    } finally {
      setUploading(false)
    }
  }
  async function pick(f?: File) {
    if (!f) return
    if (!/^image\/(jpeg|png|gif|webp)$/.test(f.type)) return setError('只支持 JPG、PNG、GIF、WEBP 格式')
    if (f.size > MAX_SIZE) return setError('图片不能超过 800KB')
    try {
      await saveAvatar(await compressAvatar(f))
    } catch (e) {
      setError(errorText(e))
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (password && password !== confirm) return setError('两次输入的密码不一致')
    setBusy(true)
    try {
      if (profile && nickname !== profile.nickname)
        setProfile(await api<ProfileData>('/auth/profile', { method: 'PUT', body: JSON.stringify({ nickname }) }))
      if (password) {
        await api('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: current, newPassword: password }) })
        notify('密码已修改，请重新登录')
        auth.clear()
        window.dispatchEvent(new Event('session-expired'))
        return
      }
      notify('个人信息已保存')
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  if (!profile) return <Card><Loading /></Card>
  return (
    <Card>
      <CardHeader title="个人信息" />
      <CardBody>
        <form className="stack" onSubmit={save}>
          <div className="profile-avatar">
            <UserAvatar profile={profile} size="xl" />
            <div className="stack">
              <div className="row">
                <Button variant="primary" icon={CloudUpload} loading={uploading} onClick={() => file.current?.click()}>
                  上传新头像
                </Button>
                <Button variant="tonal" icon={RotateCcw} disabled={uploading || !profile.avatar} onClick={() => saveAvatar(null)}>
                  重置
                </Button>
                <input
                  ref={file}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  hidden
                  onChange={(e) => {
                    void pick(e.target.files?.[0])
                    e.target.value = ''
                  }}
                />
              </div>
              <p className="text-muted">允许 JPG、PNG、GIF、WEBP 格式，最大 800KB。</p>
            </div>
          </div>
          <div className="grid-2">
            <TextField label="用户名" icon={User} value={profile.name} readOnly />
            <TextField label="昵称" icon={IdCard} maxLength={30} placeholder="显示在右上角的名称" value={nickname} onChange={(e) => setNickname(e.target.value)} />
            <TextField label="新密码" icon={LockKeyhole} secret autoComplete="new-password" maxLength={128} placeholder="不修改请留空" value={password} onChange={(e) => setPassword(e.target.value)} />
            <TextField label="确认密码" icon={LockKeyhole} secret autoComplete="new-password" maxLength={128} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            {password && (
              <TextField
                label="当前密码"
                icon={KeyRound}
                secret
                required
                autoComplete="current-password"
                maxLength={256}
                hint="修改密码需要验证当前密码，修改后所有设备需重新登录"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            )}
          </div>
          {error && <Alert tone="error">{error}</Alert>}
          <div>
            <Button type="submit" variant="primary" icon={Save} loading={busy}>
              保存
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  )
}
