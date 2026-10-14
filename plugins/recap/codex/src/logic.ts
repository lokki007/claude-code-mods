// The recap's pure logic, shared with the Claude Code pane, for the Codex companion.
// build.mjs bundles this into ../logic.mjs, which both the Node scripts and the
// companion page load. Nothing here touches the Claude Code engine.

export {
  AUTONOMY, DEPLOY, INTERVIEW_PLAIN, LANES, LANE_KEYS, SYSTEM, bestInLane, borrowable, composePrompt, favourites, isSaved,
  isWorthRecap, learnFrom, md, parseTakes, plain, promptFor, ranked, rememberWins, toggleSaved, topPicks, willInterview,
} from '../../hooks/recap'
export { DEFAULT_CLIENT, TONES, clientNote, diaryEntries, diaryPage, forClient, simplerPrompt } from '../../hooks/client'
export {
  appendLine, dataDir, diaryEntry, diaryFile, diaryHeader, nextStreak, projectKey, projectName, skipReason, withHeader,
} from '../../hooks/journal'
