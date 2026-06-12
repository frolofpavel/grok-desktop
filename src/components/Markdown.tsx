import { useState, memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import hljs from 'highlight.js/lib/core'

// Load only languages we expect to see in dev chats — keeps bundle small.
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import sql from 'highlight.js/lib/languages/sql'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import diffLang from 'highlight.js/lib/languages/diff'
import shell from 'highlight.js/lib/languages/shell'
import 'highlight.js/styles/github-dark.css'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('jsx', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('tsx', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('py', python)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('zsh', bash)
hljs.registerLanguage('shell', shell)
hljs.registerLanguage('json', json)
hljs.registerLanguage('css', css)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('yml', yaml)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('go', go)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('rs', rust)
hljs.registerLanguage('diff', diffLang)

interface CodeBlockProps {
  language: string
  code: string
}

function CodeBlock({ language, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  let highlighted = code
  let usedLang = language
  if (language && hljs.getLanguage(language)) {
    try {
      const out = hljs.highlight(code, { language, ignoreIllegals: true })
      highlighted = out.value
    } catch { /* fallback to raw */ }
  } else if (!language) {
    try {
      const auto = hljs.highlightAuto(code)
      highlighted = auto.value
      usedLang = auto.language || ''
    } catch { /* fallback to raw */ }
  }

  const isHtml = highlighted !== code

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard denied */ }
  }

  return (
    <div className="gg-code-block">
      <div className="gg-code-header">
        <span>{usedLang || 'text'}</span>
        <button className="gg-code-copy" onClick={copy}>{copied ? 'скопировано' : 'копировать'}</button>
      </div>
      <pre><code className="hljs" dangerouslySetInnerHTML={isHtml ? { __html: highlighted } : undefined}>{isHtml ? undefined : code}</code></pre>
    </div>
  )
}

const CodeBlockMemo = memo(CodeBlock)

interface MarkdownProps {
  text: string
}

export const Markdown = memo(function Markdown({ text }: MarkdownProps) {
  return (
    <div className="gg-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code(props) {
            const { className, children } = props
            const inline = !className
            if (inline) return <code>{children}</code>
            const language = (className ?? '').replace(/^language-/, '')
            const code = String(children).replace(/\n$/, '')
            return <CodeBlockMemo language={language} code={code} />
          },
          pre({ children }) {
            return <>{children}</>
          }
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})

