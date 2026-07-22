import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';

/**
 * 直接用 monaco-editor；Vite 通过 Vite 静态 import 打包到渲染层。
 *
 * V0.1：MySQL 方言（sql 语法）。V0.5：增加 oracle dialect 选项。
 *
 * 防 worker 失败（SSR / Electron 渲染进程里 worker 不存在是常态）：
 * - 走 monaco 自带的 inline worker fallback：直接 setEnvironmentVariables 注入。
 */

let initialized = false;
function ensureMonaco(): void {
  if (initialized) return;
  initialized = true;

  // 关闭语法校验（避免红色波浪线干扰），V0.5 改为开启
  monaco.languages.register({ id: 'mysql' });
  monaco.languages.setMonarchTokensProvider('mysql', {
    keywords: [
      'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'INSERT', 'INTO', 'VALUES',
      'UPDATE', 'SET', 'DELETE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER',
      'ON', 'AS', 'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET',
      'CREATE', 'ALTER', 'DROP', 'TABLE', 'INDEX', 'VIEW', 'TRIGGER',
      'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'IFNULL', 'COALESCE',
    ],
    tokenizer: {
      root: [
        [/[a-zA-Z_]\w*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
        [/\d+\.\d+/, 'number.float'],
        [/\d+/, 'number'],
        [/'([^'\\]|\\.)*'/, 'string'],
        [/"([^"\\]|\\.)*"/, 'string'],
        [/--.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
        [/[;,()=<>!\+\-\*\/]/, 'delimiter'],
      ],
      comment: [
        [/\*\//, 'comment', '@pop'],
        [/./, 'comment'],
      ],
    },
  });
}

export interface SqlEditorProps {
  value: string;
  onChange: (v: string) => void;
  language?: 'mysql';
  height?: number | string;
  onRun?: () => void;
}

export function SqlEditor(props: SqlEditorProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    ensureMonaco();
    if (!ref.current) return;

    const editor = monaco.editor.create(ref.current, {
      value: props.value,
      language: props.language ?? 'mysql',
      theme: 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      tabSize: 2,
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      fixedOverflowWidgets: true,
    });
    editorRef.current = editor;

    const sub = editor.onDidChangeModelContent(() => {
      props.onChange(editor.getValue());
    });

    if (props.onRun) {
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
        props.onRun!();
      });
    }

    return () => {
      sub.dispose();
      editor.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // props.value 变化更新（例如切 tab）
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== props.value) {
      editor.setValue(props.value);
    }
  }, [props.value]);

  return (
    <div
      ref={ref}
      style={{ height: props.height ?? '100%', width: '100%' }}
    />
  );
}