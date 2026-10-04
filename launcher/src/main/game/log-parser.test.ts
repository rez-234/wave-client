import { describe, expect, it } from 'vitest'

import { LogStreamParser } from './log-parser'

const event = (message: string, extra = '') =>
  `<log4j:Event logger="net.minecraft.client.Minecraft" timestamp="1700000000123" level="INFO" thread="Render thread">\n` +
  `  <log4j:Message><![CDATA[${message}]]></log4j:Message>\n${extra}</log4j:Event>\n`

describe('LogStreamParser', () => {
  it('parses log4j XML events', () => {
    const lines = new LogStreamParser(() => 5).push(event('Setting user: Steve'))
    expect(lines).toEqual([
      { time: 1700000000123, level: 'INFO', thread: 'Render thread', logger: 'net.minecraft.client.Minecraft', message: 'Setting user: Steve' }
    ])
  })

  it('handles events split at any point', () => {
    const text = 'JVM warning line\n' + event('first') + event('second <b>&amp;</b>')
    for (let size = 1; size < 40; size++) {
      const parser = new LogStreamParser(() => 5)
      const lines = []
      for (let i = 0; i < text.length; i += size) lines.push(...parser.push(text.slice(i, i + size)))
      lines.push(...parser.flush())
      expect(lines.map((l) => l.message), `chunk ${size}`).toEqual(['JVM warning line', 'first', 'second <b>&amp;</b>'])
    }
  })

  it('joins CDATA sections split around "]]>" and decodes entities outside CDATA', () => {
    const xml =
      '<log4j:Event logger="x" timestamp="1" level="WARN" thread="t">' +
      '<log4j:Message><![CDATA[a]]]]><![CDATA[>b]]> &lt;c&gt;</log4j:Message></log4j:Event>'
    expect(new LogStreamParser().push(xml)[0]).toMatchObject({ level: 'WARN', message: 'a]]>b <c>' })
  })

  it('keeps throwables', () => {
    const lines = new LogStreamParser().push(event('Crash', '  <log4j:Throwable><![CDATA[java.lang.RuntimeException: boom\n\tat a.b(C.java:1)\n]]></log4j:Throwable>\n'))
    expect(lines[0]!.throwable).toBe('java.lang.RuntimeException: boom\n\tat a.b(C.java:1)')
  })

  it('reads plain pattern lines and guesses levels for raw output', () => {
    const parser = new LogStreamParser(() => 7)
    const lines = parser.push('[12:00:01] [main/WARN]: careful\nException in thread "main" java.lang.Error\n\tat x.y(Z.java:3)\nhello\n')
    expect(lines.map((l) => [l.level, l.thread, l.message])).toEqual([
      ['WARN', 'main', 'careful'],
      ['FATAL', null, 'Exception in thread "main" java.lang.Error'],
      ['ERROR', null, '\tat x.y(Z.java:3)'],
      ['INFO', null, 'hello']
    ])
  })

  it('holds back an incomplete plain line until it ends', () => {
    const parser = new LogStreamParser()
    expect(parser.push('partial')).toEqual([])
    expect(parser.push(' line\n').map((l) => l.message)).toEqual(['partial line'])
    expect(parser.push('tail').length).toBe(0)
    expect(parser.flush().map((l) => l.message)).toEqual(['tail'])
  })

  it('treats unknown levels as INFO and survives a malformed event', () => {
    const lines = new LogStreamParser().push('<log4j:Event level="LOUD"><log4j:Message>x</log4j:Message></log4j:Event>')
    expect(lines[0]).toMatchObject({ level: 'INFO', message: 'x', thread: null })
  })
})
