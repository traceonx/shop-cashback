import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHubRef } from './registry-pull'

test('解析 Docker Hub 镜像引用，非 Docker Hub 仓库返回 null', () => {
  assert.deepEqual(parseHubRef('sunqz/shop-cashback:latest'), { repo: 'sunqz/shop-cashback', tag: 'latest' })
  assert.deepEqual(parseHubRef('sunqz/shop-cashback'), { repo: 'sunqz/shop-cashback', tag: 'latest' })
  assert.deepEqual(parseHubRef('containrrr/watchtower:1.7.1'), { repo: 'containrrr/watchtower', tag: '1.7.1' })
  assert.deepEqual(parseHubRef('nginx'), { repo: 'library/nginx', tag: 'latest' })
  assert.deepEqual(parseHubRef('docker.io/sunqz/shop-cashback:0.8.3'), { repo: 'sunqz/shop-cashback', tag: '0.8.3' })
  assert.equal(parseHubRef('ghcr.io/foo/bar:latest'), null)
  assert.equal(parseHubRef('192.168.5.10:5000/foo:latest'), null)
})
