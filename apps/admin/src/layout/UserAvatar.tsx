import { cx } from '../lib/format'
import { displayName, type Profile } from '../lib/profile'

/** 管理员头像：有上传头像时显示图片，否则显示名字首字母 */
export function UserAvatar({ profile, size = 'md' }: { profile: Profile | null; size?: 'md' | 'lg' | 'xl' }) {
  const name = displayName(profile)
  return (
    <span className={cx('user-avatar', `user-avatar-${size}`)}>
      {profile?.avatar ? <img src={profile.avatar} alt="" /> : name.slice(0, 1).toUpperCase()}
    </span>
  )
}
