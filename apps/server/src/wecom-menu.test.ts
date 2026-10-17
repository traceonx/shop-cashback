import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultMenu, validateMenu, menuPayload, menuCommand } from './wecom-menu'

test('默认菜单动作可路由，未知事件不触发业务', () => {
  const payload = menuPayload(defaultMenu)
  assert.equal(payload.button.length, 3)
  assert.equal(payload.button[2].sub_button.length, 4)
  for (const group of payload.button) for (const button of group.sub_button) {
    assert.equal(button.type, 'click')
    assert.ok(menuCommand(button.key)?.startsWith('/'))
  }
  assert.equal(menuCommand('SHIHUI_ORDERS'), '/订单')
  assert.equal(menuCommand('SHIHUI___proto__'), null)
  assert.equal(menuCommand('unrecognized'), null)
})
test('菜单校验限制数量、UTF8字节长度与动作白名单', () => {
  assert.throws(() => validateMenu([]))
  assert.throws(() => validateMenu([...defaultMenu, defaultMenu[0]]))
  assert.throws(() => validateMenu([{ name: '六个汉字菜单', children: defaultMenu[0].children }]))
  assert.throws(() => validateMenu([{ name: '有效', children: Array(6).fill(defaultMenu[0].children[0]) }]))
  assert.throws(() => validateMenu([{ name: '有效', children: [{ name: '菜单', action: '__proto__' }] }]))
  assert.throws(() => validateMenu([{ name: '有效', children: [{ name: '长'.repeat(14), action: 'HELP' }] }]))
  assert.equal(validateMenu([{ name: ' 菜单 ', children: [{ name: ' 帮助 ', action: 'HELP' }] }])[0].name, '菜单')
})
