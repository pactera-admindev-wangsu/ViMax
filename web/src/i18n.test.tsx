import {afterEach, describe, expect, it, vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import App from './App';
import {ArtifactsView, StoryboardPanel} from './ArtifactViews';
import {applyAgentEvent, composeAgentPrompt, createChatState} from './events';
import {formatStructuredValue, structuredRecordTitle, friendlyFieldLabel} from './artifactPresentation';
import {getLocale, LanguageSwitcher, locales, LOCALE_STORAGE_KEY, readLocale, resolveLocale, setLocale, subscribeLocale, t, translate, translateError, type StorageLike} from './i18n';
import {translations} from './translations';
import type {Artifact, SessionSummary} from './types';

afterEach(() => {
  vi.unstubAllGlobals();
  setLocale('zh-CN');
});

const artifact: Artifact = {name: 'storyboard.json', path: 'scene_0/storyboard.json', kind: 'document', size: 12, updatedAt: '', url: '/api/artifact?session=test'};
const session: SessionSummary = {sessionId: 'test', projectName: 'Settings', workingDir: 'C:/work/project', stage: 'created', summary: '', idea: '', updatedAt: '', createdAt: '', compactionTurns: 0};

describe('i18n preferences', () => {
  it('defaults to Chinese regardless of browser language and rejects invalid preferences', () => {
    for (const value of [null, undefined, '', 'fr-FR', 'en', '__proto__']) expect(resolveLocale(value)).toBe('zh-CN');
    expect(readLocale()).toBe('zh-CN');
    expect(readLocale({getItem: () => { throw new Error('denied'); }, setItem: vi.fn()})).toBe('zh-CN');
  });

  it.each(locales)('persists %s and restores it for a new page', (locale) => {
    const saved = new Map<string, string>();
    const storage: StorageLike = {getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => { saved.set(key, value); }};
    setLocale(locale, storage);
    expect(saved.get(LOCALE_STORAGE_KEY)).toBe(locale);
    expect(readLocale(storage)).toBe(locale);
  });

  it('notifies React subscribers and updates document metadata without reloading', () => {
    const doc = {documentElement: {lang: ''}, title: ''};
    const reload = vi.fn();
    vi.stubGlobal('document', doc);
    vi.stubGlobal('window', {location: {reload}});
    const listener = vi.fn();
    const unsubscribe = subscribeLocale(listener);
    setLocale('ja-JP', {getItem: () => null, setItem: () => { throw new Error('denied'); }});
    expect(getLocale()).toBe('ja-JP');
    expect(t('Settings')).toBe('設定');
    expect(doc.documentElement.lang).toBe('ja-JP');
    expect(doc.title).toContain('ワークスペース');
    expect(listener).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
    unsubscribe();
    setLocale('en-US');
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe('translation resources and rendering', () => {
  it('has nonempty Chinese/Japanese translations with identical interpolation parameters', () => {
    const parameters = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const [key, entries] of Object.entries(translations)) {
      expect(entries).toHaveLength(2);
      for (const text of entries) {
        expect(text.trim(), key).not.toBe('');
        expect(text, key).not.toContain('\uFFFD');
        expect(parameters(text), key).toEqual(parameters(key));
      }
      expect(translate('en-US', key)).toBe(key);
    }
  });

  it('covers literal translation calls and prevents new hardcoded JSX labels', () => {
    for (const name of ['App.tsx', 'ArtifactViews.tsx', 'i18n.tsx']) {
      const source = ts.createSourceFile(name, readFileSync(new URL(name, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      function visit(node: ts.Node) {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
          expect(Object.hasOwn(translations, node.arguments[0].text), node.arguments[0].text).toBe(true);
        }
        if (ts.isJsxText(node) && /[a-z]/i.test(node.text.trim())) {
          expect(['ViMax', 'V', 'configs/agent.local.yaml', 'English'].includes(node.text.trim()), node.text).toBe(true);
        }
        if (ts.isJsxAttribute(node) && ['title', 'label', 'detail', 'placeholder', 'aria-label'].includes(node.name.getText(source)) && node.initializer && ts.isStringLiteral(node.initializer)) {
          expect(node.initializer.text, node.name.getText(source)).toBe('');
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  });

  it.each([
    ['zh-CN', '设置', '产物', '分镜', '规划未完成'],
    ['en-US', 'Settings', 'Artifacts', 'Storyboard', 'Planning incomplete'],
    ['ja-JP', '設定', '成果物', '絵コンテ', '計画が未完了'],
  ] as const)('renders workspace, artifacts and storyboard in %s', (locale, settings, artifacts, storyboard, status) => {
    vi.stubGlobal('document', {documentElement: {dataset: {theme: 'light'}}});
    setLocale(locale);
    const app = renderToStaticMarkup(<App />);
    expect(app).toContain(settings);
    expect(app).toContain(`lang="${locale}"`);
    expect(app).toContain('简体中文');
    expect(app).toContain('日本語');
    const selector = renderToStaticMarkup(<LanguageSwitcher />);
    const selectedOption = selector.match(/<option[^>]*selected=""[^>]*>/)?.[0];
    expect(selectedOption).toContain(`value="${locale}"`);
    expect(renderToStaticMarkup(<ArtifactsView artifacts={[]} />)).toContain(artifacts);
    const panel = renderToStaticMarkup(<StoryboardPanel open artifacts={[]} onClose={() => {}} onCountChange={() => {}} />);
    expect(panel).toContain(storyboard);
    expect(panel).toContain(status);
    const files = renderToStaticMarkup(<ArtifactsView session={session} artifacts={[artifact]} />);
    expect(files).toContain('Settings');
    if (locale !== 'en-US') expect(files).not.toContain('documents ·');
  });

  it('localizes structured labels without translating user names, values, paths or code', () => {
    setLocale('ja-JP');
    expect(friendlyFieldLabel('motion_desc', t)).toBe('動き');
    expect(structuredRecordTitle({name: 'Settings'}, 0, artifact, t)).toBe('Settings');
    for (const value of ['Settings', 'C:/work/project', 'print("Hello")', 'api_key']) expect(formatStructuredValue(value, '', t)).toBe(value);
    expect(translate('zh-CN', 'Preview {name}', {name: 'C:/Settings.png'})).toBe('预览 C:/Settings.png');
    expect(translate('zh-CN', 'constructor')).toBe('constructor');
    expect(translate('ja-JP', '__proto__')).toBe('__proto__');
  });

  it('translates known errors while retaining HTTP codes, API fields and unknown diagnostics', () => {
    setLocale('zh-CN');
    expect(translateError('Request failed with HTTP 503')).toBe('请求失败，HTTP 503');
    expect(translateError('Upload failed with HTTP 413')).toBe('上传失败，HTTP 413');
    expect(translateError('File exceeds the 100 MB upload limit')).toContain('100 MB');
    expect(translateError('llm.base_url must use http:// or https://')).toContain('llm.base_url');
    expect(translateError('Agent is not running')).toBe('Agent 尚未运行');
    expect(translateError('C:/work/config.yaml: custom provider error')).toBe('C:/work/config.yaml: custom provider error');
  });

  it.each(locales)('keeps Agent messages and tool payloads unchanged in %s', (locale) => {
    setLocale(locale);
    const state = applyAgentEvent(createChatState(), {type: 'token', turn_id: 'test', delta: 'Settings'});
    expect(state.messages[0].text).toBe('Settings');
    const result = applyAgentEvent(state, {type: 'tool_start', turn_id: 'test', tool: {name: 'vimax_render_video', id: 'call1'}});
    expect(result.messages[1].tool).toBe('vimax_render_video');
    expect(composeAgentPrompt('Settings', ['C:/work/a.png'])).toBe('Settings <workspace_uploads>["C:/work/a.png"]</workspace_uploads>');
  });
});
