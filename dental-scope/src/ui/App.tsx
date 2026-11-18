import { useEffect, useRef, useState } from 'react';
import { navigate, startRouter } from '../app/router';
import { useT } from '../i18n';
import { actions, getState, useApp } from '../state/store';
import { useServices } from './context';
import { DetailPanel } from './DetailPanel';
import { Dock, SimpleDock } from './Dock';
import { IconArrowLeft, IconInfo, IconLayers, IconReset, IconSearch, IconSection, IconTooth } from './icons';
import { LayersPanel } from './LayersPanel';
import { AboutDialog, Footer, LoadingCard } from './Overlays';
import { SearchPanel } from './SearchPanel';
import { Identity, QuizNewNote, SimpleTopActions, TopActions } from './TopBar';
import { CLINIC, CLINIC_NAME, SIMPLE } from '../app/simple';
import { useKeyboard } from './useKeyboard';
import { useViewportInsets } from './useViewportInsets';
import { GuidedTour } from './GuidedTour';
import { CreditsDialog } from './CreditsDialog';
import { QuizMode } from './QuizMode';
import { EXPLORE_MODE, QUIZ_MODE, switchMode } from '../modes/modes';

export function App() {
  const { engine, registry } = useServices();
  const stage = useRef<HTMLDivElement>(null);
  const quizButton = useRef<HTMLButtonElement>(null);
  const theme = useApp((s) => s.theme);
  const selected = useApp((s) => !!s.selectedId);
  const dissect = useApp((s) => s.dissectFdi !== null);
  const sheet = useApp((s) => s.mobileSheet);
  const lang = useApp((s) => s.lang);
  const quiz = useApp((s) => s.mode === 'quiz');
  const simple = useApp((s) => s.simpleUI);
  const m = useT();

  useEffect(() => {
    engine.mount(stage.current!);
    void engine.loadAll();
    const stop = startRouter(engine, registry);
    return () => {
      stop();
      engine.dispose();
    };
  }, [engine, registry]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useKeyboard(engine);

  const ready = useApp((s) => s.ready);
  const resetId = useApp((s) => s.resetId);
  useEffect(() => {
    if (!getState().simpleUI || !ready || location.hash.length > 2) return;
    const t = window.setTimeout(() => engine.zoom(0.8), 350);
    return () => window.clearTimeout(t);
  }, [engine, ready, resetId]);

  useViewportInsets(engine);

  return (
    <div className={`ds-app${SIMPLE ? ' is-embed' : ''}${simple ? ' is-simple' : ''}${selected ? ' has-selection' : ''}${dissect ? ' is-dissecting' : ''}${quiz ? ' is-quiz' : ''}`} data-sheet={sheet}>
      <div className="ds-stage" ref={stage} {...(quiz ? { role: 'img', 'aria-label': m.quizBoardAria } : {})} />
      <div className="ds-ui">
        {SIMPLE ? <ToolsSwitch /> : CLINIC ? <ClinicIdentity /> : <Identity />}
        {simple ? <SimpleTopActions /> : <TopActions />}
        {!quiz && !simple && <LayersPanel />}
        {!quiz && <DetailPanel />}
        {simple ? <SimpleDock /> : <Dock />}
        {simple && <SimpleHint />}
        <Footer />
        <ResetButton />
        <LoadingCard />
        {quiz && <QuizMode />}
        <nav className="ds-mobile-bar ds-panel" aria-label={m.mobileControls}>
          {!quiz && !simple && <button type="button" className={sheet === 'layers' ? 'is-active' : ''} onClick={() => actions.setMobileSheet(sheet === 'layers' ? 'none' : 'layers')} aria-pressed={sheet === 'layers'}>
            <IconLayers /> <span>{m.layers}</span>
          </button>}
          {!quiz && <button type="button" data-tour="search" onClick={() => actions.openSearch(true)}>
            <IconSearch /> <span>{m.search}</span>
          </button>}
          {!simple && <button
            ref={quizButton}
            type="button"
            className="ds-mobile-mode"
            onClick={() => (quiz ? switchMode(QUIZ_MODE, EXPLORE_MODE, { registry, engine }) : switchMode(EXPLORE_MODE, QUIZ_MODE, { registry, engine }))}
          >
            {quiz ? <IconArrowLeft /> : <IconTooth />} <span>{quiz ? m.mode.explore : m.mode.quiz}</span>
          </button>}
          {!simple && <QuizNewNote anchor={quizButton} placement="above" />}
          {!simple && <button type="button" className={sheet === 'tools' ? 'is-active' : ''} onClick={() => actions.setMobileSheet(sheet === 'tools' ? 'none' : 'tools')} aria-pressed={sheet === 'tools'}>
            <IconSection /> <span>{m.tools}</span>
          </button>}
          {!quiz && selected && <button type="button" className={sheet === 'detail' ? 'is-active' : ''} onClick={() => actions.setMobileSheet(sheet === 'detail' ? 'none' : 'detail')} aria-pressed={sheet === 'detail'}>
            <IconInfo /> <span>{m.details}</span>
          </button>}
        </nav>
        {sheet !== 'none' && <button type="button" className="ds-scrim" aria-label={m.closePanel} onClick={() => actions.setMobileSheet('none')} />}
      </div>
      {!quiz && <SearchPanel />}
      <AboutDialog />
      <CreditsDialog />
      <GuidedTour />
    </div>
  );
}

/** Clinic build, full page: the clinic's name (back to its site) instead of the Dental Scope title. */
function ClinicIdentity() {
  return (
    <header className="ds-identity ds-identity--clinic">
      <a className="ds-eyebrow ds-clinic-back" href="/">← {CLINIC_NAME || 'Back to the clinic'}</a>
      <h1 className="ds-title">3D Teeth Explorer</h1>
      <ToolsSwitch />
    </header>
  );
}

/** Clinic embed, top-left: switch between the simple patient controls and every tool. */
function ToolsSwitch() {
  const simple = useApp((s) => s.simpleUI);
  const quiz = useApp((s) => s.mode === 'quiz');
  const { engine, registry } = useServices();
  const toSimple = () => {
    if (quiz) switchMode(QUIZ_MODE, EXPLORE_MODE, { registry, engine });
    actions.setSimpleUI(true);
  };
  return (
    <div className="ds-tools-switch ds-segmented" role="radiogroup" aria-label="Controls">
      <button type="button" role="radio" aria-checked={simple} className={simple ? 'is-active' : ''} onClick={toSimple}>Simple view</button>
      <button type="button" role="radio" aria-checked={!simple} className={!simple ? 'is-active' : ''} onClick={() => actions.setSimpleUI(false)}>All tools</button>
    </div>
  );
}

/** Simple mode: a one-line "how to" for patients; goes away once they start exploring. */
function SimpleHint() {
  const selected = useApp((s) => !!s.selectedId);
  const [closed, setClosed] = useState(false);
  if (closed || selected) return null;
  return (
    <div className="ds-simple-hint ds-panel" role="note">
      <span><b>Drag</b> to turn</span>
      <span><b>Pinch</b> or <b>scroll</b> to zoom</span>
      <span><b>Tap a tooth</b> to learn about it</span>
      <button type="button" className="ds-icon-btn" aria-label="Hide tips" onClick={() => setClosed(true)}>×</button>
    </div>
  );
}

/** Bottom-left: back to the start view with every setting at its default. */
function ResetButton() {
  const { engine } = useServices();
  const m = useT();
  const guideOpen = useApp(s => s.guideOpen);
  const reset = () => {
    void navigate(() => { actions.resetAll(); engine.resetToStart(); });
  };
  return (
    <button type="button" className={`ds-reset-all${guideOpen ? ' is-guide-reset' : ''}`} onClick={reset} title={m.resetAllTitle} aria-label={m.resetAllTitle}>
      <IconReset size={15} />
      <span>{SIMPLE ? 'Start over' : m.resetAll}</span>
    </button>
  );
}
