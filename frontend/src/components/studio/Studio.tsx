import { useState, useEffect, useRef, useCallback } from "react"
import type { DocInfo } from "../../lib/types"
import type { StudioElement } from "../../lib/studioTypes"
import { fetchSlideElements, updateElementPosition, renderSingleSlide, deleteElement, duplicateElement as duplicateElementApi, undoDoc, redoDoc, createNewElement, copyElementToSlide, createImageElement, fetchUndoState, alignElements, fetchElementStyle, updateElementStyle, updateElementFlags, applyLayoutPreset, groupElements, ungroupElement, generateSlideContent, rerenderAllSlides, importSlides, bulkUpdateStyle, generateNotesBulk, addSlide, duplicateSlide, fetchSlidePins, pinSlide, bulkDeleteElementsByName, optimizeSlideLayout, splitElementToSlides, insertSummarySlide, autoDetectSections, fitTextToElements, optimizeImages, expandSlide, mergeElements, generateAltTextBulk, statsExportCsvUrl, statsExportJsonUrl, polishSlideText, insertToc, outlineExportUrl, notesExportUrl, generateConclusionSlide, thumbnailsZipUrl, textExportUrl, fixNumberedLists, cloneSlideTo, duplicateDeck, bulkFontReplace, clearNotes } from "../../lib/studioApi"
import type { ElementStyleData } from "../../lib/studioTypes"
import * as api from "../../lib/api"
import StudioSlideStrip from "./StudioSlideStrip"
import StudioCanvas from "./StudioCanvas"
import StudioPropertiesPanel from "./StudioPropertiesPanel"
import StudioToolbar from "./StudioToolbar"  // legacy — kept for fallback / type-compat; not currently rendered
import StudioRibbon from "./StudioRibbon"
import StudioAgent, { loadAgentCollapsed, saveAgentCollapsed } from "./StudioAgent"
import ConnectModal from "./ConnectModal"
void StudioToolbar  // suppress unused-import warning while we leave the file around
import StudioNotesBar from "./StudioNotesBar"
import CommandPalette from "./CommandPalette"
import SlideSorterModal from "./SlideSorterModal"
import FindReplacePanel from "./FindReplacePanel"
import KeyboardShortcutsModal from "./KeyboardShortcutsModal"
import OutlinePanel from "./OutlinePanel"
import PresentationMode from "./PresentationMode"
import LayersPanel from "./LayersPanel"
import ColorSwapPanel from "./ColorSwapPanel"
import FontSwapPanel from "./FontSwapPanel"
import NotesReviewPanel from "./NotesReviewPanel"
import TemplateVariablesPanel from "./TemplateVariablesPanel"
import AgendaSlideModal from "./AgendaSlideModal"
import AIPresentationScoreModal from "./AIPresentationScoreModal"
import SlideNumbersModal from "./SlideNumbersModal"
import WatermarkModal from "./WatermarkModal"
import TransitionsModal from "./TransitionsModal"
import SlideCompareModal from "./SlideCompareModal"
import GrammarCheckModal from "./GrammarCheckModal"
import ThemeGeneratorModal from "./ThemeGeneratorModal"
import SlideVariationModal from "./SlideVariationModal"
import TranslateModal from "./TranslateModal"
import ReorderSuggestModal from "./ReorderSuggestModal"
import SimilarSlidesModal from "./SimilarSlidesModal"
import BrandCheckModal from "./BrandCheckModal"
import ContentDensityModal from "./ContentDensityModal"
import ReadabilityModal from "./ReadabilityModal"
import DeckHealthModal from "./DeckHealthModal"
import RehearsalTimerModal from "./RehearsalTimerModal"
import SnapshotManagerModal from "./SnapshotManagerModal"
import VoiceoverScriptModal from "./VoiceoverScriptModal"
import DeckSummaryModal from "./DeckSummaryModal"
import SlideDiffModal from "./SlideDiffModal"
import ActionItemsModal from "./ActionItemsModal"
import KeywordCloudModal from "./KeywordCloudModal"
import QuestionGeneratorModal from "./QuestionGeneratorModal"
import PresentationCoachModal from "./PresentationCoachModal"
import TitleOptimizerModal from "./TitleOptimizerModal"
import StoryboardModal from "./StoryboardModal"
import LayoutIssuesModal from "./LayoutIssuesModal"
import AudienceAdapterModal from "./AudienceAdapterModal"
import StyleAuditModal from "./StyleAuditModal"
import TimerBudgetModal from "./TimerBudgetModal"
import ReadingLevelModal from "./ReadingLevelModal"
import TextCaseModal from "./TextCaseModal"
import ImpactScoresModal from "./ImpactScoresModal"
import EmotionalToneModal from "./EmotionalToneModal"
import ImageGalleryModal from "./ImageGalleryModal"
import AccessibilityReportModal from "./AccessibilityReportModal"
import AutoTagSlidesModal from "./AutoTagSlidesModal"
import CoverSlideModal from "./CoverSlideModal"
import ProgressBarModal from "./ProgressBarModal"
import PreflightModal from "./PreflightModal"
import HookWriterModal from "./HookWriterModal"
import SectionSeparatorModal from "./SectionSeparatorModal"
import FormatPresetsModal from "./FormatPresetsModal"
import DuplicateFinderModal from "./DuplicateFinderModal"
import NotesExpandModal from "./NotesExpandModal"
import ComplexityModal from "./ComplexityModal"
import ContentGapsModal from "./ContentGapsModal"
import GlossaryModal from "./GlossaryModal"
import TitleGeneratorModal from "./TitleGeneratorModal"
import LayoutAnalyzerModal from "./LayoutAnalyzerModal"
import SpeakingPaceModal from "./SpeakingPaceModal"
import CitationTrackerModal from "./CitationTrackerModal"
import ContrastCheckerModal from "./ContrastCheckerModal"
import QAPrepModal from "./QAPrepModal"
import SlideSummarizerModal from "./SlideSummarizerModal"
import NoteTemplateModal from "./NoteTemplateModal"
import KeywordSpotlightModal from "./KeywordSpotlightModal"
import TextStatsModal from "./TextStatsModal"
import EmojiRemoverModal from "./EmojiRemoverModal"
import CapitalizeTitlesModal from "./CapitalizeTitlesModal"
import PullQuoteModal from "./PullQuoteModal"
import FlowFeedbackModal from "./FlowFeedbackModal"
import FootnoteModal from "./FootnoteModal"
import WordCloudModal from "./WordCloudModal"
import ColorPaletteModal from "./ColorPaletteModal"
import SlideLabelsModal from "./SlideLabelsModal"
import DeckTitleModal from "./DeckTitleModal"
import BlankSlideModal from "./BlankSlideModal"
import SlideProgressModal from "./SlideProgressModal"
import HighlightReelModal from "./HighlightReelModal"
import FontAuditModal from "./FontAuditModal"
import ExecutiveBriefingModal from "./ExecutiveBriefingModal"
import MarginCheckModal from "./MarginCheckModal"
import DeckTaglineModal from "./DeckTaglineModal"
import SectionWordCountModal from "./SectionWordCountModal"
import ComplexityHeatmapModal from "./ComplexityHeatmapModal"
import ReorderRationaleModal from "./ReorderRationaleModal"
import ReadingOrderModal from "./ReadingOrderModal"
import TitleSlideCritiqueModal from "./TitleSlideCritiqueModal"
import ClutterScoreModal from "./ClutterScoreModal"
import CTASlideModal from "./CTASlideModal"
import OpeningHookModal from "./OpeningHookModal"
import TOCCheckModal from "./TOCCheckModal"
import LinkCheckerModal from "./LinkCheckerModal"
import MetaphorFinderModal from "./MetaphorFinderModal"
import SpeakerConfidenceModal from "./SpeakerConfidenceModal"
import StyleGuideModal from "./StyleGuideModal"
import AgendaSyncModal from "./AgendaSyncModal"
import PaceCheckerModal from "./PaceCheckerModal"
import CounterArgumentsModal from "./CounterArgumentsModal"
import HumorSuggestionsModal from "./HumorSuggestionsModal"
import DataTableModal from "./DataTableModal"
import AlignmentAuditModal from "./AlignmentAuditModal"
import NotesLengthModal from "./NotesLengthModal"
import DeckQuizModal from "./DeckQuizModal"
import BackgroundAuditModal from "./BackgroundAuditModal"
import PlaceholderFinderModal from "./PlaceholderFinderModal"
import ActionPlanModal from "./ActionPlanModal"
import SectionTitleModal from "./SectionTitleModal"
import BookmarkManagerModal from "./BookmarkManagerModal"
import DataInsightsModal from "./DataInsightsModal"
import NarrativeArcModal from "./NarrativeArcModal"
import GridCheckModal from "./GridCheckModal"
import PersuasionScoreModal from "./PersuasionScoreModal"
import SocialSnippetsModal from "./SocialSnippetsModal"
import TextOverflowModal from "./TextOverflowModal"
import AudienceQuestionsModal from "./AudienceQuestionsModal"
import ToneConsistencyModal from "./ToneConsistencyModal"
import SentenceVarietyModal from "./SentenceVarietyModal"
import ExportChecklistModal from "./ExportChecklistModal"
import ImageDescriptionsModal from "./ImageDescriptionsModal"
import RedundancyFinderModal from "./RedundancyFinderModal"
import PassiveVoiceModal from "./PassiveVoiceModal"
import EmotionalKeywordsModal from "./EmotionalKeywordsModal"
import DeckCompareModal from "./DeckCompareModal"
import JargonDetectorModal from "./JargonDetectorModal"
import StoryArcModal from "./StoryArcModal"
import FillerWordsModal from "./FillerWordsModal"
import AcronymExplainerModal from "./AcronymExplainerModal"
import WeakVerbsModal from "./WeakVerbsModal"
import BulletAnalysisModal from "./BulletAnalysisModal"
import TimerEstimateModal from "./TimerEstimateModal"
import ColorReportModal from "./ColorReportModal"
import WhitespaceModal from "./WhitespaceModal"
import FontPairingModal from "./FontPairingModal"
import SectionSummaryModal from "./SectionSummaryModal"
import FirstImpressionModal from "./FirstImpressionModal"
import CTAStrengthModal from "./CTAStrengthModal"
import KeywordDensityModal from "./KeywordDensityModal"
import RepetitionHeatmapModal from "./RepetitionHeatmapModal"
import ClaimCheckerModal from "./ClaimCheckerModal"
import DiscussionQuestionsModal from "./DiscussionQuestionsModal"
import VocabularyLevelModal from "./VocabularyLevelModal"
import CompletenessReportModal from "./CompletenessReportModal"
import VisualHierarchyModal from "./VisualHierarchyModal"
import SentimentArcModal from "./SentimentArcModal"
import TaglineVariationsModal from "./TaglineVariationsModal"
import SlideLengthModal from "./SlideLengthModal"
import TransitionPacingModal from "./TransitionPacingModal"
import HookStrengthModal from "./HookStrengthModal"
import DataDensityModal from "./DataDensityModal"
import ClosingImpactModal from "./ClosingImpactModal"
import RedundantSlidesModal from "./RedundantSlidesModal"
import ToneShiftModal from "./ToneShiftModal"
import PersuasionFrameworkModal from "./PersuasionFrameworkModal"
import ConfidenceScoresModal from "./ConfidenceScoresModal"
import ComplexityIndexModal from "./ComplexityIndexModal"
import QuoteExtractorModal from "./QuoteExtractorModal"
import PresentationRisksModal from "./PresentationRisksModal"
import AudienceFitModal from "./AudienceFitModal"
import AnalogyFinderModal from "./AnalogyFinderModal"
import ActionVerbsModal from "./ActionVerbsModal"
import EmotionalPayoffModal from "./EmotionalPayoffModal"
import ClarityScoreModal from "./ClarityScoreModal"
import BuzzwordDensityModal from "./BuzzwordDensityModal"
import SlideIntentModal from "./SlideIntentModal"
import NarrativeGapsModal from "./NarrativeGapsModal"
import EvidenceAuditModal from "./EvidenceAuditModal"
import CompetitiveLanguageModal from "./CompetitiveLanguageModal"
import MetaphorDensityModal from "./MetaphorDensityModal"
import ImpactRankingModal from "./ImpactRankingModal"
import ContentBalanceModal from "./ContentBalanceModal"
import SpeakerDensityModal from "./SpeakerDensityModal"
import AcronymMapModal from "./AcronymMapModal"
import PromiseTrackerModal from "./PromiseTrackerModal"
import SlideRepetitionModal from "./SlideRepetitionModal"
import NumericConsistencyModal from "./NumericConsistencyModal"
import TitleUniquenessModal from "./TitleUniquenessModal"
import DeckPunchlineModal from "./DeckPunchlineModal"
import OpeningStatsModal from "./OpeningStatsModal"
import UrgencyDetectorModal from "./UrgencyDetectorModal"
import QuestionCountModal from "./QuestionCountModal"
import ValuePropositionModal from "./ValuePropositionModal"
import TopicCoverageModal from "./TopicCoverageModal"
import DensityHeatmapModal from "./DensityHeatmapModal"
import PresentationDNAModal from "./PresentationDNAModal"
import SpeakerTipsModal from "./SpeakerTipsModal"
import ObjectionHandlerModal from "./ObjectionHandlerModal"
import SlideQuestionsModal from "./SlideQuestionsModal"
import DeckManifestoModal from "./DeckManifestoModal"
import BulletBrevityModal from "./BulletBrevityModal"
import InsightExtractorModal from "./InsightExtractorModal"
import SlideTransitionsInfoModal from "./SlideTransitionsInfoModal"
import StoryGapFillerModal from "./StoryGapFillerModal"
import ImageTextRatioModal from "./ImageTextRatioModal"
import MetaphorSuggesterModal from "./MetaphorSuggesterModal"
import EmojiUsageModal from "./EmojiUsageModal"
import SlideMoodBoardModal from "./SlideMoodBoardModal"
import LongSentencesModal from "./LongSentencesModal"
import DeckElevatorPitchModal from "./DeckElevatorPitchModal"
import HeaderFooterCheckModal from "./HeaderFooterCheckModal"
import SectionIntrosModal from "./SectionIntrosModal"
import TextAlignmentAuditModal from "./TextAlignmentAuditModal"
import ReframeSuggestionsModal from "./ReframeSuggestionsModal"
import PassiveConstructionsModal from "./PassiveConstructionsModal"
import SlideTaglinesModal from "./SlideTaglinesModal"
import PunctuationAuditModal from "./PunctuationAuditModal"
import AuthoritySignalsModal from "./AuthoritySignalsModal"
import ShapeInventoryModal from "./ShapeInventoryModal"
import AssumptionCheckerModal from "./AssumptionCheckerModal"
import FontSizeDistributionModal from "./FontSizeDistributionModal"
import KeyMessageExtractorModal from "./KeyMessageExtractorModal"
import TextColorAuditModal from "./TextColorAuditModal"
import CompetitivePositioningModal from "./CompetitivePositioningModal"
import EmptyNotesFinderModal from "./EmptyNotesFinderModal"
import DeckQuizGeneratorModal from "./DeckQuizGeneratorModal"
import SlideSymmetryModal from "./SlideSymmetryModal"
import ObjectionMapModal from "./ObjectionMapModal"
import TextDensityPerWordModal from "./TextDensityPerWordModal"
import SlideStoryBeatsModal from "./SlideStoryBeatsModal"
import PlaceholderTextFinderModal from "./PlaceholderTextFinderModal"
import AudienceJourneyMapModal from "./AudienceJourneyMapModal"
import LinkDensityModal from "./LinkDensityModal"
import PresentationSummaryBulletsModal from "./PresentationSummaryBulletsModal"
import ColorContrastAuditModal from "./ColorContrastAuditModal"
import DeckPersonalityModal from "./DeckPersonalityModal"
import TitleLengthAuditModal from "./TitleLengthAuditModal"
import CallToActionFinderModal from "./CallToActionFinderModal"
import SlideWordCountHistogramModal from "./SlideWordCountHistogramModal"
import RhetoricalDeviceFinderModal from "./RhetoricalDeviceFinderModal"
import ShapeZOrderAuditModal from "./ShapeZOrderAuditModal"
import CompetitiveGapAnalyzerModal from "./CompetitiveGapAnalyzerModal"
import BulletCountPerSlideModal from "./BulletCountPerSlideModal"
import SlideHookAnalyzerModal from "./SlideHookAnalyzerModal"
import ImageCaptionCheckerModal from "./ImageCaptionCheckerModal"
import DataStoryCheckerModal from "./DataStoryCheckerModal"
import SlidePacingScoreModal from "./SlidePacingScoreModal"
import TrustSignalFinderModal from "./TrustSignalFinderModal"
import RepeatedWordsAuditModal from "./RepeatedWordsAuditModal"
import SlideTransitionsAdvisorModal from "./SlideTransitionsAdvisorModal"
import SlideLayoutTypeAuditModal from "./SlideLayoutTypeAuditModal"
import OpeningCloserEvaluatorModal from "./OpeningCloserEvaluatorModal"
import AcronymFinderModal from "./AcronymFinderModal"
import SlideComplexityRankerModal from "./SlideComplexityRankerModal"
import NumberedListConsistencyModal from "./NumberedListConsistencyModal"
import PersuasionFrameworkDetectorModal from "./PersuasionFrameworkDetectorModal"
import SlideAspectRatioCheckModal from "./SlideAspectRatioCheckModal"
import ValuePropositionExtractorModal from "./ValuePropositionExtractorModal"
import ChartCountPerSlideModal from "./ChartCountPerSlideModal"
import NarrativeArcScorerModal from "./NarrativeArcScorerModal"
import DuplicateSlideDetectorModal from "./DuplicateSlideDetectorModal"
import SlideReorderAdvisorModal from "./SlideReorderAdvisorModal"
import TableCountAuditModal from "./TableCountAuditModal"
import EmotionalToneProfilerModal from "./EmotionalToneProfilerModal"
import HeadingHierarchyCheckModal from "./HeadingHierarchyCheckModal"
import PitchReadinessScoreModal from "./PitchReadinessScoreModal"
import FontVarietyAuditModal from "./FontVarietyAuditModal"
import SlideMetaphorFinderModal from "./SlideMetaphorFinderModal"
import EmptySlideDetectorModal from "./EmptySlideDetectorModal"
import ClosingStrengthEvaluatorModal from "./ClosingStrengthEvaluatorModal"
import SlideTitleUniquenessModal from "./SlideTitleUniquenessModal"
import OpeningHookRaterModal from "./OpeningHookRaterModal"
import SpeakerNoteLengthCheckerModal from "./SpeakerNoteLengthCheckerModal"
import CompetitorMentionFinderModal from "./CompetitorMentionFinderModal"
import SlideImageCountModal from "./SlideImageCountModal"
import PresentationTaglineGeneratorModal from "./PresentationTaglineGeneratorModal"
import LongSentenceDetectorModal from "./LongSentenceDetectorModal"
import StakeholderConcernMapperModal from "./StakeholderConcernMapperModal"
import SlideColorPaletteModal from "./SlideColorPaletteModal"
import ContentDensityScorerModal from "./ContentDensityScorerModal"
import BulletLengthAuditModal from "./BulletLengthAuditModal"
import PresentationGapFillerModal from "./PresentationGapFillerModal"
import ShapeCountPerSlideModal from "./ShapeCountPerSlideModal"
import SlideTitleImproverModal from "./SlideTitleImproverModal"
import NumericDataSpotterModal from "./NumericDataSpotterModal"
import ObjectionHandlerGeneratorModal from "./ObjectionHandlerGeneratorModal"
import TextCaseAuditModal from "./TextCaseAuditModal"
import AudiencePersonaBuilderModal from "./AudiencePersonaBuilderModal"
import SlideFootnoteFinderModal from "./SlideFootnoteFinderModal"
import DeckExecutiveSummaryModal from "./DeckExecutiveSummaryModal"
import SlideHyperlinkAuditModal from "./SlideHyperlinkAuditModal"
import PersuasionIntensityRaterModal from "./PersuasionIntensityRaterModal"
import ConsistentIconographyCheckModal from "./ConsistentIconographyCheckModal"
import OnePageSummaryGeneratorModal from "./OnePageSummaryGeneratorModal"
import ShapeVisibilityAuditModal from "./ShapeVisibilityAuditModal"
import IcebreakerSlideGeneratorModal from "./IcebreakerSlideGeneratorModal"
import SlideBackgroundColorModal from "./SlideBackgroundColorModal"
import NarrativeConsistencyCheckerModal from "./NarrativeConsistencyCheckerModal"
import SlideLayerOrderAuditModal from "./SlideLayerOrderAuditModal"
import BrandVoiceScorerModal from "./BrandVoiceScorerModal"
import PunctuationConsistencyCheckModal from "./PunctuationConsistencyCheckModal"
import SlideSplitRecommenderModal from "./SlideSplitRecommenderModal"
import SlideTextDensityModal from "./SlideTextDensityModal"
import SlideTransitionSuggesterModal from "./SlideTransitionSuggesterModal"
import DuplicateSlideContentModal from "./DuplicateSlideContentModal"
import CtaStrengthRaterModal from "./CtaStrengthRaterModal"
import AgendaSlideDetectorModal from "./AgendaSlideDetectorModal"
import PassiveVoiceDetectorModal from "./PassiveVoiceDetectorModal"
import SlideLengthEstimatorModal from "./SlideLengthEstimatorModal"
import DataClaimCheckerModal from "./DataClaimCheckerModal"
import SlideQuoteFinderModal from "./SlideQuoteFinderModal"
import AbbreviationFinderModal from "./AbbreviationFinderModal"
import PresentationMoodAnalyzerModal from "./PresentationMoodAnalyzerModal"
import JargonFinderModal from "./JargonFinderModal"
import TitleSlideDetectorModal from "./TitleSlideDetectorModal"
import QuestionSlideFinderModal from "./QuestionSlideFinderModal"
import SlideThemeExtractorModal from "./SlideThemeExtractorModal"
import SlideComplexityScorerModal from "./SlideComplexityScorerModal"
import SlideTitleLengthCheckerModal from "./SlideTitleLengthCheckerModal"
import TestimonialSlideFinderModal from "./TestimonialSlideFinderModal"
import SlideSentimentTrendModal from "./SlideSentimentTrendModal"
import ColorCountPerSlideModal from "./ColorCountPerSlideModal"
import SlideFontSizeAuditModal from "./SlideFontSizeAuditModal"
import PresenterNotesSummarizerModal from "./PresenterNotesSummarizerModal"
import SlideImageQualityCheckerModal from "./SlideImageQualityCheckerModal"
import ContentFreshnessCheckerModal from "./ContentFreshnessCheckerModal"
import SlideTocGeneratorModal from "./SlideTocGeneratorModal"
import RiskStatementFinderModal from "./RiskStatementFinderModal"
import VisualMetaphorCheckerModal from "./VisualMetaphorCheckerModal"
import SlideActionPlanExtractorModal from "./SlideActionPlanExtractorModal"
import GenerateFromOutlineModal from "./GenerateFromOutlineModal"
import DocStatsModal from "./DocStatsModal"
import CommentsPanel from "./CommentsPanel"
import PresentationCheckModal from "./PresentationCheckModal"
import ProjectShareModal from "./ProjectShareModal"
import { setupNativeRenderers } from "./renderers"
import { useToast } from "../Toaster"
import { useStudioCollab } from "../../lib/collab/useStudioCollab"
import { getCollabContext } from "../../lib/collab/collabContext"
import { hydrateElement as ydocHydrateElement, deleteElement as ydocDeleteElement } from "../../lib/collab/bridgeYjsAdapter"
import { useAuth } from "../../auth/AuthContext"
import { setPendingAutoEdit } from "../../lib/pendingAutoEdit"

setupNativeRenderers()

interface Props {
  doc: DocInfo
  onRebuild: () => void
  rebuilding: boolean
}

export default function Studio({ doc, onRebuild, rebuilding }: Props) {
  const toast = useToast()
  const { user: authUser } = useAuth()
  const [selectedSlide, setSelectedSlide]     = useState(1)
  const [selectedElement, setSelectedElement] = useState<StudioElement | null>(null)
  const [slideWidthIn, setSlideWidthIn]       = useState(13.333)
  const [slideHeightIn, setSlideHeightIn]     = useState(7.5)
  const [refreshKey, setRefreshKey]           = useState(0)
  const [agentCollapsed, setAgentCollapsed] = useState<boolean>(() => loadAgentCollapsed())
  // Properties panel collapse state. Manual override is sticky; otherwise
  // we default to "collapsed when nothing is selected" so the canvas isn't
  // crowded by an inspector with no element to inspect.
  const [propsManualOverride, setPropsManualOverride] = useState<boolean | null>(() => {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem("percy_props_collapsed_v1") : null
    if (v === "true")  return true
    if (v === "false") return false
    return null
  })

  // Yjs collaboration room for the current slide. Tries WebSocket first
  // (via VITE_YJS_WS_URL) so cross-machine multiplayer works as soon as
  // the relay server is up; falls back to BroadcastChannel automatically
  // when the env var isn't set, so dev keeps working without a server.
  // Multiplayer transport. App Runner's WebSocket support is incompatible
  // with VPC-connector egress; the collab service uses DEFAULT egress (no
  // VPC) so wss:// upgrades succeed. If the relay is down, the transport
  // silently degrades to BroadcastChannel after a couple of reconnect
  // failures (multi-tab same-browser still works).
  const { remoteUserCount } = useStudioCollab(
    doc.doc_id,
    selectedSlide,
    authUser ? { id: authUser.id, name: authUser.display_name } : null,
    /* enabled */ true,
    /* transport */ "websocket",
  )
  const [connectModalElementId, setConnectModalElementId] = useState<string | null>(null)
  const [docConnects, setDocConnects] = useState<{ slide_n: number; element_id: string }[]>([])
  const [findReplaceOpen, setFindReplaceOpen] = useState(false)
  const [localSlideCount, setLocalSlideCount] = useState(doc.slide_count)
  const [savingToCloud, setSavingToCloud]     = useState(false)
  const [generating, setGenerating]           = useState(false)
  const [outlineOpen, setOutlineOpen]         = useState(false)
  const [presenting, setPresenting]           = useState(false)
  const [layersOpen, setLayersOpen]           = useState(false)
  const [rerenderingAll, setRerenderingAll]   = useState(false)
  const [colorSwapOpen, setColorSwapOpen]     = useState(false)
  const [fontSwapOpen, setFontSwapOpen]       = useState(false)
  const [notesReviewOpen, setNotesReviewOpen] = useState(false)
  const [templateVarsOpen, setTemplateVarsOpen] = useState(false)
  const [agendaSlideOpen, setAgendaSlideOpen]   = useState(false)
  const [aiScoreOpen, setAiScoreOpen]           = useState(false)
  const [shareOpen, setShareOpen]               = useState(false)
  const [colorBlindMode, setColorBlindMode]     = useState<string | null>(null)
  const [slideNumbersOpen, setSlideNumbersOpen] = useState(false)
  const [watermarkOpen, setWatermarkOpen]       = useState(false)
  const [transitionsOpen, setTransitionsOpen]   = useState(false)
  const [optimizingLayout, setOptimizingLayout] = useState(false)
  const [compareOpen, setCompareOpen]           = useState(false)
  const [grammarOpen, setGrammarOpen]           = useState(false)
  const [themeGenOpen, setThemeGenOpen]         = useState(false)
  const [variationOpen, setVariationOpen]       = useState(false)
  const [translateOpen, setTranslateOpen]       = useState(false)
  const [reorderOpen, setReorderOpen]           = useState(false)
  const [similarOpen, setSimilarOpen]           = useState(false)
  const [brandCheckOpen, setBrandCheckOpen]     = useState(false)
  const [densityOpen, setDensityOpen]           = useState(false)
  const [readabilityOpen, setReadabilityOpen]   = useState(false)
  const [deckHealthOpen, setDeckHealthOpen]     = useState(false)
  const [rehearsalOpen, setRehearsalOpen]       = useState(false)
  const [snapshotOpen, setSnapshotOpen]         = useState(false)
  const [voiceoverOpen, setVoiceoverOpen]       = useState(false)
  const [deckSummaryOpen, setDeckSummaryOpen]   = useState(false)
  const [slideDiffOpen, setSlideDiffOpen]       = useState(false)
  const [actionItemsOpen, setActionItemsOpen]   = useState(false)
  const [keywordsOpen, setKeywordsOpen]         = useState(false)
  const [questionsOpen, setQuestionsOpen]       = useState(false)
  const [coachOpen, setCoachOpen]               = useState(false)
  const [titleOptOpen, setTitleOptOpen]         = useState(false)
  const [storyboardOpen, setStoryboardOpen]     = useState(false)
  const [layoutIssuesOpen, setLayoutIssuesOpen] = useState(false)
  const [audienceAdaptOpen, setAudienceAdaptOpen] = useState(false)
  const [styleAuditOpen, setStyleAuditOpen]       = useState(false)
  const [timerBudgetOpen, setTimerBudgetOpen]     = useState(false)
  const [readingLevelOpen, setReadingLevelOpen]   = useState(false)
  const [textCaseOpen, setTextCaseOpen]           = useState(false)
  const [impactScoresOpen, setImpactScoresOpen]   = useState(false)
  const [emotionalToneOpen, setEmotionalToneOpen] = useState(false)
  const [imageGalleryOpen, setImageGalleryOpen]   = useState(false)
  const [accessibilityOpen, setAccessibilityOpen] = useState(false)
  const [autoTagOpen, setAutoTagOpen]             = useState(false)
  const [coverSlideOpen, setCoverSlideOpen]       = useState(false)
  const [progressBarOpen, setProgressBarOpen]     = useState(false)
  const [preflightOpen, setPreflightOpen]         = useState(false)
  const [hookWriterOpen, setHookWriterOpen]       = useState(false)
  const [sectionSepOpen, setSectionSepOpen]       = useState(false)
  const [formatPresetsOpen, setFormatPresetsOpen] = useState(false)
  const [duplicateFinderOpen, setDuplicateFinderOpen] = useState(false)
  const [notesExpandOpen, setNotesExpandOpen]         = useState(false)
  const [complexityOpen, setComplexityOpen]           = useState(false)
  const [contentGapsOpen, setContentGapsOpen]         = useState(false)
  const [glossaryOpen, setGlossaryOpen]               = useState(false)
  const [titleGenOpen, setTitleGenOpen]               = useState(false)
  const [layoutAnalyzerOpen, setLayoutAnalyzerOpen]   = useState(false)
  const [speakingPaceOpen, setSpeakingPaceOpen]       = useState(false)
  const [citationOpen, setCitationOpen]               = useState(false)
  const [contrastOpen, setContrastOpen]               = useState(false)
  const [qaPrepOpen, setQaPrepOpen]                   = useState(false)
  const [slideSummarizerOpen, setSlideSummarizerOpen] = useState(false)
  const [noteTemplateOpen, setNoteTemplateOpen]       = useState(false)
  const [keywordSpotlightOpen, setKeywordSpotlightOpen] = useState(false)
  const [textStatsOpen, setTextStatsOpen]               = useState(false)
  const [emojiRemoverOpen, setEmojiRemoverOpen]         = useState(false)
  const [capitalizeTitlesOpen, setCapitalizeTitlesOpen] = useState(false)
  const [pullQuoteOpen, setPullQuoteOpen]               = useState(false)
  const [flowFeedbackOpen, setFlowFeedbackOpen]         = useState(false)
  const [footnoteOpen, setFootnoteOpen]                 = useState(false)
  const [wordCloudOpen, setWordCloudOpen]               = useState(false)
  const [colorPaletteOpen, setColorPaletteOpen]         = useState(false)
  const [slideLabelsOpen, setSlideLabelsOpen]           = useState(false)
  const [deckTitleOpen, setDeckTitleOpen]               = useState(false)
  const [blankSlideOpen, setBlankSlideOpen]             = useState(false)
  const [slideProgressOpen, setSlideProgressOpen]       = useState(false)
  const [highlightReelOpen, setHighlightReelOpen]       = useState(false)
  const [fontAuditOpen, setFontAuditOpen]               = useState(false)
  const [execBriefingOpen, setExecBriefingOpen]         = useState(false)
  const [marginCheckOpen, setMarginCheckOpen]           = useState(false)
  const [deckTaglineOpen, setDeckTaglineOpen]           = useState(false)
  const [sectionWordCountOpen, setSectionWordCountOpen] = useState(false)
  const [complexityHeatmapOpen, setComplexityHeatmapOpen] = useState(false)
  const [reorderRationaleOpen, setReorderRationaleOpen]   = useState(false)
  const [readingOrderOpen, setReadingOrderOpen]           = useState(false)
  const [titleCritiqueOpen, setTitleCritiqueOpen]         = useState(false)
  const [clutterScoreOpen, setClutterScoreOpen]           = useState(false)
  const [ctaSlideOpen, setCtaSlideOpen]                   = useState(false)
  const [openingHookOpen, setOpeningHookOpen]             = useState(false)
  const [tocCheckOpen, setTocCheckOpen]                   = useState(false)
  const [linkCheckerOpen, setLinkCheckerOpen]             = useState(false)
  const [metaphorOpen, setMetaphorOpen]                   = useState(false)
  const [speakerConfidenceOpen, setSpeakerConfidenceOpen] = useState(false)
  const [styleGuideOpen, setStyleGuideOpen]               = useState(false)
  const [agendaSyncOpen, setAgendaSyncOpen]               = useState(false)
  const [paceCheckerOpen, setPaceCheckerOpen]             = useState(false)
  const [counterArgsOpen, setCounterArgsOpen]             = useState(false)
  const [humorOpen, setHumorOpen]                         = useState(false)
  const [dataTableOpen, setDataTableOpen]                 = useState(false)
  const [alignmentAuditOpen, setAlignmentAuditOpen]       = useState(false)
  const [notesLengthOpen, setNotesLengthOpen]             = useState(false)
  const [deckQuizOpen, setDeckQuizOpen]                   = useState(false)
  const [backgroundAuditOpen, setBackgroundAuditOpen]     = useState(false)
  const [placeholderOpen, setPlaceholderOpen]             = useState(false)
  const [actionPlanOpen, setActionPlanOpen]               = useState(false)
  const [sectionTitleOpen, setSectionTitleOpen]           = useState(false)
  const [bookmarkOpen, setBookmarkOpen]                   = useState(false)
  const [dataInsightsOpen, setDataInsightsOpen]           = useState(false)
  const [narrativeArcOpen, setNarrativeArcOpen]           = useState(false)
  const [gridCheckOpen, setGridCheckOpen]                 = useState(false)
  const [persuasionScoreOpen, setPersuasionScoreOpen]     = useState(false)
  const [socialSnippetsOpen, setSocialSnippetsOpen]       = useState(false)
  const [textOverflowOpen, setTextOverflowOpen]           = useState(false)
  const [audienceQuestionsOpen, setAudienceQuestionsOpen] = useState(false)
  const [toneConsistencyOpen, setToneConsistencyOpen]     = useState(false)
  const [sentenceVarietyOpen, setSentenceVarietyOpen]     = useState(false)
  const [exportChecklistOpen, setExportChecklistOpen]     = useState(false)
  const [imageDescOpen, setImageDescOpen]                 = useState(false)
  const [redundancyOpen, setRedundancyOpen]               = useState(false)
  const [passiveVoiceOpen, setPassiveVoiceOpen]           = useState(false)
  const [emotionalKwOpen, setEmotionalKwOpen]             = useState(false)
  const [deckCompareOpen, setDeckCompareOpen]             = useState(false)
  const [jargonOpen, setJargonOpen]                       = useState(false)
  const [storyArcOpen, setStoryArcOpen]                   = useState(false)
  const [fillerWordsOpen, setFillerWordsOpen]             = useState(false)
  const [acronymOpen, setAcronymOpen]                     = useState(false)
  const [weakVerbsOpen, setWeakVerbsOpen]                 = useState(false)
  const [bulletAnalysisOpen, setBulletAnalysisOpen]       = useState(false)
  const [timerEstimateOpen, setTimerEstimateOpen]         = useState(false)
  const [colorReportOpen, setColorReportOpen]             = useState(false)
  const [whitespaceOpen, setWhitespaceOpen]               = useState(false)
  const [fontPairingOpen, setFontPairingOpen]             = useState(false)
  const [sectionSummaryOpen, setSectionSummaryOpen]       = useState(false)
  const [firstImpressionOpen, setFirstImpressionOpen]     = useState(false)
  const [ctaStrengthOpen, setCtaStrengthOpen]             = useState(false)
  const [keywordDensityOpen, setKeywordDensityOpen]       = useState(false)
  const [repetitionHeatmapOpen, setRepetitionHeatmapOpen] = useState(false)
  const [claimCheckerOpen, setClaimCheckerOpen]           = useState(false)
  const [discussionQxOpen, setDiscussionQxOpen]           = useState(false)
  const [vocabularyOpen, setVocabularyOpen]               = useState(false)
  const [completenessOpen, setCompletenessOpen]           = useState(false)
  const [visualHierarchyOpen, setVisualHierarchyOpen]     = useState(false)
  const [sentimentArcOpen, setSentimentArcOpen]           = useState(false)
  const [taglineVarsOpen, setTaglineVarsOpen]             = useState(false)
  const [slideLengthOpen, setSlideLengthOpen]             = useState(false)
  const [transitionPacingOpen, setTransitionPacingOpen]   = useState(false)
  const [hookStrengthOpen, setHookStrengthOpen]           = useState(false)
  const [dataDensityOpen, setDataDensityOpen]             = useState(false)
  const [closingImpactOpen, setClosingImpactOpen]         = useState(false)
  const [redundantSlidesOpen, setRedundantSlidesOpen]     = useState(false)
  const [toneShiftOpen, setToneShiftOpen]                 = useState(false)
  const [persuasionFwOpen, setPersuasionFwOpen]           = useState(false)
  const [confidenceScoresOpen, setConfidenceScoresOpen]   = useState(false)
  const [complexityIndexOpen, setComplexityIndexOpen]     = useState(false)
  const [quoteExtractorOpen, setQuoteExtractorOpen]       = useState(false)
  const [presentationRisksOpen, setPresentationRisksOpen] = useState(false)
  const [audienceFitOpen, setAudienceFitOpen]             = useState(false)
  const [analogyFinderOpen, setAnalogyFinderOpen]         = useState(false)
  const [actionVerbsOpen, setActionVerbsOpen]             = useState(false)
  const [emotionalPayoffOpen, setEmotionalPayoffOpen]     = useState(false)
  const [clarityScoreOpen, setClarityScoreOpen]           = useState(false)
  const [buzzwordDensityOpen, setBuzzwordDensityOpen]     = useState(false)
  const [slideIntentOpen, setSlideIntentOpen]             = useState(false)
  const [narrativeGapsOpen, setNarrativeGapsOpen]         = useState(false)
  const [evidenceAuditOpen, setEvidenceAuditOpen]         = useState(false)
  const [competitiveLangOpen, setCompetitiveLangOpen]     = useState(false)
  const [metaphorDensityOpen, setMetaphorDensityOpen]     = useState(false)
  const [impactRankingOpen, setImpactRankingOpen]         = useState(false)
  const [contentBalanceOpen, setContentBalanceOpen]       = useState(false)
  const [speakerDensityOpen, setSpeakerDensityOpen]       = useState(false)
  const [acronymMapOpen, setAcronymMapOpen]               = useState(false)
  const [promiseTrackerOpen, setPromiseTrackerOpen]       = useState(false)
  const [slideRepetitionOpen, setSlideRepetitionOpen]     = useState(false)
  const [numericConsistOpen, setNumericConsistOpen]       = useState(false)
  const [titleUniquenessOpen, setTitleUniquenessOpen]     = useState(false)
  const [deckPunchlineOpen, setDeckPunchlineOpen]         = useState(false)
  const [openingStatsOpen, setOpeningStatsOpen]           = useState(false)
  const [urgencyDetectorOpen, setUrgencyDetectorOpen]     = useState(false)
  const [questionCountOpen, setQuestionCountOpen]         = useState(false)
  const [valuePropOpen, setValuePropOpen]                 = useState(false)
  const [topicCoverageOpen, setTopicCoverageOpen]         = useState(false)
  const [densityHeatmapOpen, setDensityHeatmapOpen]       = useState(false)
  const [presentationDNAOpen, setPresentationDNAOpen]     = useState(false)
  const [speakerTipsOpen, setSpeakerTipsOpen]             = useState(false)
  const [objectionHandlerOpen, setObjectionHandlerOpen]   = useState(false)
  const [slideQuestionsOpen, setSlideQuestionsOpen]       = useState(false)
  const [deckManifestoOpen, setDeckManifestoOpen]         = useState(false)
  const [bulletBrevityOpen, setBulletBrevityOpen]         = useState(false)
  const [insightExtractorOpen, setInsightExtractorOpen]   = useState(false)
  const [slideTransInfoOpen, setSlideTransInfoOpen]       = useState(false)
  const [storyGapFillerOpen, setStoryGapFillerOpen]       = useState(false)
  const [imageTextRatioOpen, setImageTextRatioOpen]       = useState(false)
  const [metaphorSuggesterOpen, setMetaphorSuggesterOpen] = useState(false)
  const [emojiUsageOpen, setEmojiUsageOpen]               = useState(false)
  const [slideMoodBoardOpen, setSlideMoodBoardOpen]       = useState(false)
  const [longSentencesOpen, setLongSentencesOpen]         = useState(false)
  const [elevatorPitchOpen, setElevatorPitchOpen]         = useState(false)
  const [headerFooterOpen, setHeaderFooterOpen]           = useState(false)
  const [sectionIntrosOpen, setSectionIntrosOpen]         = useState(false)
  const [textAlignAuditOpen, setTextAlignAuditOpen]       = useState(false)
  const [reframeSuggestOpen, setReframeSuggestOpen]       = useState(false)
  const [passiveConstructOpen, setPassiveConstructOpen]   = useState(false)
  const [slideTaglinesOpen, setSlideTaglinesOpen]         = useState(false)
  const [punctuationAuditOpen, setPunctuationAuditOpen]   = useState(false)
  const [authoritySignalsOpen, setAuthoritySignalsOpen]   = useState(false)
  const [shapeInventoryOpen, setShapeInventoryOpen]       = useState(false)
  const [assumptionCheckerOpen, setAssumptionCheckerOpen] = useState(false)
  const [fontSizeDistOpen, setFontSizeDistOpen]           = useState(false)
  const [keyMessageOpen, setKeyMessageOpen]               = useState(false)
  const [textColorAuditOpen, setTextColorAuditOpen]       = useState(false)
  const [competitivePosOpen, setCompetitivePosOpen]       = useState(false)
  const [emptyNotesOpen, setEmptyNotesOpen]               = useState(false)
  const [deckQuizGenOpen, setDeckQuizGenOpen]             = useState(false)
  const [slideSymmetryOpen, setSlideSymmetryOpen]         = useState(false)
  const [objectionMapOpen, setObjectionMapOpen]           = useState(false)
  const [textDensityWordOpen, setTextDensityWordOpen]     = useState(false)
  const [storyBeatsOpen, setStoryBeatsOpen]               = useState(false)
  const [placeholderFinderOpen, setPlaceholderFinderOpen] = useState(false)
  const [audienceJourneyOpen, setAudienceJourneyOpen]     = useState(false)
  const [linkDensityOpen, setLinkDensityOpen]             = useState(false)
  const [summaryBulletsOpen, setSummaryBulletsOpen]       = useState(false)
  const [colorContrastOpen, setColorContrastOpen]         = useState(false)
  const [deckPersonalityOpen, setDeckPersonalityOpen]     = useState(false)
  const [titleLengthOpen, setTitleLengthOpen]             = useState(false)
  const [ctaFinderOpen, setCtaFinderOpen]                 = useState(false)
  const [wordHistogramOpen, setWordHistogramOpen]         = useState(false)
  const [rhetoricalOpen, setRhetoricalOpen]               = useState(false)
  const [zOrderOpen, setZOrderOpen]                       = useState(false)
  const [compGapOpen, setCompGapOpen]                     = useState(false)
  const [bulletCountOpen, setBulletCountOpen]             = useState(false)
  const [hookAnalyzerOpen, setHookAnalyzerOpen]           = useState(false)
  const [imgCaptionOpen, setImgCaptionOpen]               = useState(false)
  const [dataStoryOpen, setDataStoryOpen]                 = useState(false)
  const [pacingOpen, setPacingOpen]                       = useState(false)
  const [trustSignalOpen, setTrustSignalOpen]             = useState(false)
  const [repeatedWordsOpen, setRepeatedWordsOpen]         = useState(false)
  const [transitionsAdvisorOpen, setTransitionsAdvisorOpen] = useState(false)
  const [layoutAuditOpen, setLayoutAuditOpen]               = useState(false)
  const [openingCloserOpen, setOpeningCloserOpen]           = useState(false)
  const [complexityRankerOpen, setComplexityRankerOpen]     = useState(false)
  const [numberedListOpen, setNumberedListOpen]             = useState(false)
  const [persuasionOpen, setPersuasionOpen]                 = useState(false)
  const [boundsCheckOpen, setBoundsCheckOpen]               = useState(false)
  const [valuePropExtractOpen, setValuePropExtractOpen]     = useState(false)
  const [chartCountOpen, setChartCountOpen]                 = useState(false)
  const [duplicateSlideOpen, setDuplicateSlideOpen]         = useState(false)
  const [reorderAdvisorOpen, setReorderAdvisorOpen]         = useState(false)
  const [tableCountOpen, setTableCountOpen]                 = useState(false)
  const [headingHierarchyOpen, setHeadingHierarchyOpen]     = useState(false)
  const [pitchReadinessOpen, setPitchReadinessOpen]         = useState(false)
  const [fontVarietyOpen, setFontVarietyOpen]               = useState(false)
  const [emptySlideOpen, setEmptySlideOpen]                 = useState(false)
  const [closingStrengthOpen, setClosingStrengthOpen]       = useState(false)
  const [speakerNoteLenOpen, setSpeakerNoteLenOpen]         = useState(false)
  const [competitorMentionOpen, setCompetitorMentionOpen]   = useState(false)
  const [slideImageCountOpen, setSlideImageCountOpen]       = useState(false)
  const [taglineGenOpen, setTaglineGenOpen]                 = useState(false)
  const [longSentenceOpen, setLongSentenceOpen]             = useState(false)
  const [stakeholderConcernOpen, setStakeholderConcernOpen] = useState(false)
  const [contentDensityOpen, setContentDensityOpen]         = useState(false)
  const [bulletLengthOpen, setBulletLengthOpen]             = useState(false)
  const [gapFillerOpen, setGapFillerOpen]                   = useState(false)
  const [shapeCountOpen, setShapeCountOpen]                 = useState(false)
  const [titleImproverOpen, setTitleImproverOpen]           = useState(false)
  const [numericDataOpen, setNumericDataOpen]               = useState(false)
  const [audiencePersonaOpen, setAudiencePersonaOpen]       = useState(false)
  const [footnoteFinderOpen, setFootnoteFinderOpen]         = useState(false)
  const [execSummaryOpen, setExecSummaryOpen]               = useState(false)
  const [hyperlinkAuditOpen, setHyperlinkAuditOpen]         = useState(false)
  const [persuasionRaterOpen, setPersuasionRaterOpen]       = useState(false)
  const [iconographyOpen, setIconographyOpen]               = useState(false)
  const [onePageSummaryOpen, setOnePageSummaryOpen]         = useState(false)
  const [shapeVisibilityOpen, setShapeVisibilityOpen]       = useState(false)
  const [icebreakerOpen, setIcebreakerOpen]                 = useState(false)
  const [bgColorOpen, setBgColorOpen]                       = useState(false)
  const [narrativeConsistOpen, setNarrativeConsistOpen]     = useState(false)
  const [layerOrderOpen, setLayerOrderOpen]               = useState(false)
  const [brandVoiceOpen, setBrandVoiceOpen]               = useState(false)
  const [punctConsistOpen, setPunctConsistOpen]           = useState(false)
  const [splitRecommendOpen, setSplitRecommendOpen]       = useState(false)
  const [textDensityOpen, setTextDensityOpen]             = useState(false)
  const [transitionOpen, setTransitionOpen]               = useState(false)
  const [dupSlideOpen, setDupSlideOpen]                   = useState(false)
  const [ctaRaterOpen, setCtaRaterOpen]                   = useState(false)
  const [agendaDetectorOpen, setAgendaDetectorOpen]       = useState(false)
  const [dataClaimOpen, setDataClaimOpen]                 = useState(false)
  const [quoteFinderOpen, setQuoteFinderOpen]             = useState(false)
  const [abbreviationOpen, setAbbreviationOpen]           = useState(false)
  const [moodAnalyzerOpen, setMoodAnalyzerOpen]           = useState(false)
  const [jargonFinderOpen, setJargonFinderOpen]           = useState(false)
  const [titleSlideOpen, setTitleSlideOpen]               = useState(false)
  const [questionSlideOpen, setQuestionSlideOpen]         = useState(false)
  const [themeExtractorOpen, setThemeExtractorOpen]       = useState(false)
  const [complexityScorerOpen, setComplexityScorerOpen]   = useState(false)
  const [testimonialOpen, setTestimonialOpen]             = useState(false)
  const [sentimentTrendOpen, setSentimentTrendOpen]       = useState(false)
  const [colorCountOpen, setColorCountOpen]               = useState(false)
  const [fontSizeAuditOpen, setFontSizeAuditOpen]         = useState(false)
  const [notesSummaryOpen, setNotesSummaryOpen]           = useState(false)
  const [imageQualityOpen, setImageQualityOpen]           = useState(false)
  const [freshnessOpen, setFreshnessOpen]                 = useState(false)
  const [tocGenOpen, setTocGenOpen]                       = useState(false)
  const [riskFinderOpen, setRiskFinderOpen]               = useState(false)
  const [visualMetaphorOpen, setVisualMetaphorOpen]       = useState(false)
  const [statsOpen, setStatsOpen]             = useState(false)
  const [checkOpen, setCheckOpen]             = useState(false)
  const [commentsOpen, setCommentsOpen]       = useState(false)
  const [shortcutsOpen, setShortcutsOpen]       = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [slideSorterOpen, setSlideSorterOpen]       = useState(false)
  const [outlineGenOpen, setOutlineGenOpen]         = useState(false)
  const [focusMode, setFocusMode]                   = useState(false)
  const [slideCtxMenu, setSlideCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const [formatPaintMode, setFormatPaintMode]   = useState(false)
  const formatPaintStyleRef = useRef<ElementStyleData | null>(null)
  const [dirtySlides, setDirtySlides]         = useState<Set<number>>(new Set())
  const [multiSelectIds, setMultiSelectIds]   = useState<Set<string>>(new Set())
  const [undoDepth, setUndoDepth]             = useState(0)
  const [redoDepth, setRedoDepth]             = useState(0)
  const [slideElements, setSlideElements]     = useState<StudioElement[]>([])
  const [pinnedSlides, setPinnedSlides]       = useState<Set<number>>(new Set())
  const selectedSlideRef = useRef(1)
  selectedSlideRef.current = selectedSlide
  const localSlideCountRef = useRef(localSlideCount)
  localSlideCountRef.current = localSlideCount
  const clipboardRef = useRef<{ slideN: number; elementId: string } | null>(null)

  // keep a ref so the arrow-key handler always sees the latest element
  const selectedElementRef = useRef<StudioElement | null>(null)
  selectedElementRef.current = selectedElement

  // fetch initial undo/redo state on mount
  useEffect(() => {
    fetchUndoState(doc.doc_id)
      .then((r) => { setUndoDepth(r.undo_depth); setRedoDepth(r.redo_depth) })
      .catch(() => {})
  }, [doc.doc_id])

  // load pinned slides on mount
  useEffect(() => {
    fetchSlidePins(doc.doc_id)
      .then((r) => setPinnedSlides(new Set(r.pinned)))
      .catch(() => {})
  }, [doc.doc_id])

  // Update browser tab title when document changes
  useEffect(() => {
    const prev = document.title
    document.title = `${doc.name} — Percy Studio`
    return () => { document.title = prev }
  }, [doc.name])

  // fetch slide dimensions + element list when slide changes or refreshKey bumps
  useEffect(() => {
    fetchSlideElements(doc.doc_id, selectedSlide)
      .then((res) => {
        setSlideWidthIn(res.slide_width_in)
        setSlideHeightIn(res.slide_height_in)
        setSlideElements(res.elements)
      })
      .catch(() => {})
  }, [doc.doc_id, selectedSlide, refreshKey])

  // fetch deck-wide list of bound elements so the canvas + AI panel can show them
  useEffect(() => {
    let cancelled = false
    fetch(`/api/docs/${doc.doc_id}/connects`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : { connects: [] })
      .then((j) => { if (!cancelled) setDocConnects(j.connects || []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [doc.doc_id, refreshKey])

  // Set of element IDs (on the active slide) that have a Connect attached.
  const connectIdsThisSlide = new Set(
    docConnects.filter((c) => c.slide_n === selectedSlide).map((c) => c.element_id)
  )

  const markDirty = useCallback((n: number) => {
    setDirtySlides((prev) => { const next = new Set(prev); next.add(n); return next })
  }, [])

  // ── re-render current slide PNG then bump refreshKey ─────────────────────
  const rerender = useCallback(async () => {
    const n = selectedSlideRef.current
    markDirty(n)
    try { await renderSingleSlide(doc.doc_id, n) } catch { /* non-fatal */ }
    setRefreshKey((k) => k + 1)
  }, [doc.doc_id, markDirty])

  // ── commit a position/size change from toolbar or arrow keys ──────────────
  const handleCommitPosition = useCallback(async (
    leftIn: number, topIn: number, widthIn: number, heightIn: number,
  ) => {
    const el = selectedElementRef.current
    if (!el) return
    try {
      const updated = await updateElementPosition(doc.doc_id, selectedSlideRef.current, el.id, {
        left_in: leftIn, top_in: topIn, width_in: widthIn, height_in: heightIn,
      })
      setSelectedElement(updated)
      markDirty(selectedSlideRef.current)
      await rerender()
    } catch (e) {
      console.error("position commit failed:", e)
    }
  }, [doc.doc_id, rerender])

  // ── commit a z-index change from arrange buttons ───────────────────────────
  const handleCommitZIndex = useCallback(async (zIndex: number) => {
    const el = selectedElementRef.current
    if (!el) return
    try {
      const updated = await updateElementPosition(doc.doc_id, selectedSlideRef.current, el.id, { z_index: zIndex })
      setSelectedElement(updated)
      markDirty(selectedSlideRef.current)
      await rerender()
    } catch (e) {
      console.error("z-index commit failed:", e)
    }
  }, [doc.doc_id, rerender])

  const multiSelectIdsRef = useRef<Set<string>>(new Set())
  multiSelectIdsRef.current = multiSelectIds

  // ── delete selected element(s) ────────────────────────────────────────────
  // Phase D: write Y.Doc deletion FIRST so remote peers see the element vanish
  // immediately. The API call is the persistence layer; future migration
  // moves persistence into the collab worker.
  const handleDelete = useCallback(async () => {
    const ids = multiSelectIdsRef.current
    const el  = selectedElementRef.current
    const toDelete = ids.size > 0 ? [...ids] : el ? [el.id] : []
    if (!toDelete.length) return
    const collab = getCollabContext()
    if (collab?.enabled && collab.room) {
      try {
        for (const id of toDelete) ydocDeleteElement(collab.room, id)
      } catch (e) { console.warn("[Percy] Y.Doc delete failed:", e) }
    }
    try {
      for (const id of toDelete) {
        await deleteElement(doc.doc_id, selectedSlideRef.current, id)
      }
      setSelectedElement(null)
      setMultiSelectIds(new Set())
      markDirty(selectedSlideRef.current)
      setRefreshKey((k) => k + 1)
    } catch (e) {
      console.error("delete failed:", e)
    }
  }, [doc.doc_id, markDirty])

  const handleDeleteById = useCallback(async (id: string) => {
    const collab = getCollabContext()
    if (collab?.enabled && collab.room) {
      try {
        ydocDeleteElement(collab.room, id)
      } catch (e) { console.warn("[Percy] Y.Doc delete failed:", e) }
    }
    try {
      await deleteElement(doc.doc_id, selectedSlideRef.current, id)
      setSelectedElement((prev) => prev?.id === id ? null : prev)
      setMultiSelectIds((prev) => { const next = new Set(prev); next.delete(id); return next })
      markDirty(selectedSlideRef.current)
      setRefreshKey((k) => k + 1)
    } catch (e) { console.error("delete failed:", e) }
  }, [doc.doc_id, markDirty])

  const handleToggleFlags = useCallback(async (id: string, flags: { locked?: boolean; hidden?: boolean }) => {
    try {
      const updated = await updateElementFlags(doc.doc_id, selectedSlideRef.current, id, flags)
      setSlideElements((prev) => prev.map((el) => el.id === id ? updated : el))
      if (selectedElementRef.current?.id === id) setSelectedElement(updated)
    } catch (e) { console.error("flag update failed:", e) }
  }, [doc.doc_id])

  // ── duplicate selected element(s) ─────────────────────────────────────────
  const handleDuplicate = useCallback(async () => {
    const ids = multiSelectIdsRef.current
    const el  = selectedElementRef.current
    const toDup = ids.size > 0 ? [...ids] : el ? [el.id] : []
    if (!toDup.length) return
    try {
      let lastDup: StudioElement | null = null
      for (const id of toDup) {
        lastDup = await duplicateElementApi(doc.doc_id, selectedSlideRef.current, id)
      }
      if (lastDup) setSelectedElement(lastDup)
      setMultiSelectIds(new Set())
      markDirty(selectedSlideRef.current)
      setRefreshKey((k) => k + 1)
    } catch (e) {
      console.error("duplicate failed:", e)
    }
  }, [doc.doc_id, markDirty])

  const handleGroupElements = useCallback(async () => {
    const ids = [...multiSelectIdsRef.current]
    if (ids.length < 2) return
    try {
      const group = await groupElements(doc.doc_id, selectedSlideRef.current, ids)
      setSelectedElement(group)
      setMultiSelectIds(new Set([group.id]))
      markDirty(selectedSlideRef.current)
      setRefreshKey((k) => k + 1)
    } catch (e) { console.error("group failed:", e) }
  }, [doc.doc_id, markDirty])

  const handleUngroupElement = useCallback(async () => {
    const el = selectedElementRef.current
    if (!el || el.type !== "BridgeGroup") return
    try {
      const res = await ungroupElement(doc.doc_id, selectedSlideRef.current, el.id)
      setSelectedElement(null)
      setMultiSelectIds(new Set(res.elements.map((e) => e.id)))
      markDirty(selectedSlideRef.current)
      setRefreshKey((k) => k + 1)
    } catch (e) { console.error("ungroup failed:", e) }
  }, [doc.doc_id, markDirty])

  const handleGenerateSlide = useCallback(async (prompt: string) => {
    setGenerating(true)
    try {
      await generateSlideContent(doc.doc_id, selectedSlideRef.current, prompt)
      markDirty(selectedSlideRef.current)
      setRefreshKey((k) => k + 1)
    } catch (e) { console.error("generate failed:", e) }
    finally { setGenerating(false) }
  }, [doc.doc_id, markDirty])

  const handleApplyLayout = useCallback(async (layout: string) => {
    try {
      await applyLayoutPreset(doc.doc_id, selectedSlideRef.current, layout)
      markDirty(selectedSlideRef.current)
      setRefreshKey((k) => k + 1)
    } catch (e) { console.error("layout apply failed:", e) }
  }, [doc.doc_id, markDirty])

  const handleCopyToSlide = useCallback(async (targetN: number) => {
    const el = selectedElementRef.current
    if (!el) return
    try {
      await copyElementToSlide(doc.doc_id, selectedSlideRef.current, el.id, targetN)
      markDirty(targetN)
    } catch (e) { console.error("copy-to-slide failed:", e) }
  }, [doc.doc_id, markDirty])

  // ── align multiple selected elements ─────────────────────────────────────
  const handleAlignElements = useCallback(async (alignment: string) => {
    const ids = [...multiSelectIdsRef.current]
    if (ids.length < 2) return
    try {
      await alignElements(doc.doc_id, selectedSlideRef.current, ids, alignment)
      markDirty(selectedSlideRef.current)
      setRefreshKey((k) => k + 1)
    } catch (e) {
      console.error("align failed:", e)
    }
  }, [doc.doc_id, markDirty])

  // ── format painter ────────────────────────────────────────────────────────
  const handleFormatPaint = useCallback(async () => {
    const el = selectedElementRef.current
    if (!el) return
    try {
      const style = await fetchElementStyle(doc.doc_id, selectedSlideRef.current, el.id)
      formatPaintStyleRef.current = style
      setFormatPaintMode(true)
    } catch (e) {
      console.error("format paint fetch failed:", e)
    }
  }, [doc.doc_id])

  // Apply paint when a new element is selected while paint mode is on
  const prevElementIdRef = useRef<string | null>(null)
  useEffect(() => {
    const el = selectedElement
    if (!el) return
    if (el.id === prevElementIdRef.current) return
    prevElementIdRef.current = el.id
    if (!formatPaintMode || !formatPaintStyleRef.current) return
    const style = formatPaintStyleRef.current
    setFormatPaintMode(false)
    formatPaintStyleRef.current = null
    updateElementStyle(doc.doc_id, selectedSlideRef.current, el.id, style)
      .then(() => { markDirty(selectedSlideRef.current); setRefreshKey((k) => k + 1) })
      .catch((err) => console.error("format paint apply failed:", err))
  }, [selectedElement, formatPaintMode, doc.doc_id, markDirty])

  const handleInsertShape = useCallback(async (shapeType: string) => {
    const W = 3.0, H = shapeType === "text_box" ? 1.0 : 2.0
    // Find a position that doesn't overlap too much with existing elements
    const existing = slideElements
    const SLIDE_W = slideWidthIn || 13.33, SLIDE_H = slideHeightIn || 7.5
    let bestL = 1.0, bestT = 1.0, minOverlap = Infinity
    for (let tRow = 0; tRow < 4; tRow++) {
      for (let tCol = 0; tCol < 4; tCol++) {
        const l = tCol * (SLIDE_W / 4), t = tRow * (SLIDE_H / 4)
        if (l + W > SLIDE_W || t + H > SLIDE_H) continue
        const overlap = existing.reduce((sum, e) => {
          const ox = Math.max(0, Math.min(l + W, e.left_in + e.width_in) - Math.max(l, e.left_in))
          const oy = Math.max(0, Math.min(t + H, e.top_in + e.height_in) - Math.max(t, e.top_in))
          return sum + ox * oy
        }, 0)
        if (overlap < minOverlap) { minOverlap = overlap; bestL = l + 0.25; bestT = t + 0.25 }
      }
    }
    try {
      const el = await createNewElement(doc.doc_id, selectedSlideRef.current, {
        shape_type: shapeType,
        left_in: bestL, top_in: bestT, width_in: W, height_in: H,
        fill_color: shapeType === "text_box" ? "" : "#4472C4",
        label: shapeType.charAt(0).toUpperCase() + shapeType.slice(1),
      })
      if (shapeType === "text_box") setPendingAutoEdit(el.id)
      setSelectedElement(el)
      // Phase D: write the new element to Y.Doc so peers see it instantly.
      const collab = getCollabContext()
      if (collab?.enabled && collab.room) {
        try { ydocHydrateElement(collab.room, el) }
        catch (e) { console.warn("[Percy] Y.Doc add failed:", e) }
      }
      markDirty(selectedSlideRef.current)
      setRefreshKey((k) => k + 1)
      fetchUndoState(doc.doc_id).then((r) => { setUndoDepth(r.undo_depth); setRedoDepth(r.redo_depth) }).catch(() => {})
    } catch (e) {
      console.error("insert failed:", e)
    }
  }, [doc.doc_id, markDirty, slideElements, slideWidthIn, slideHeightIn])

  // ── arrow key nudge + Delete/Duplicate keyboard shortcuts ─────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return
      // Tiptap (and any other rich-text editor) uses a contenteditable DIV.
      // We MUST treat that as "user is typing" and let the editor handle the
      // key. Otherwise Backspace deletes the whole element instead of one
      // character — the bug the user reported as "backspace spazzes out".
      if (target.isContentEditable || target.closest('[contenteditable="true"]')) return

      // Delete / Backspace → remove element
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedElementRef.current) { e.preventDefault(); handleDelete() }
        return
      }

      // Ctrl+Shift+C → copy style (format painter activate)
      if ((e.key === "c" || e.key === "C") && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        if (selectedElementRef.current) { e.preventDefault(); handleFormatPaint() }
        return
      }

      // Ctrl+C → copy element to clipboard
      if ((e.key === "c" || e.key === "C") && (e.ctrlKey || e.metaKey)) {
        const el = selectedElementRef.current
        if (el) {
          e.preventDefault()
          clipboardRef.current = { slideN: selectedSlideRef.current, elementId: el.id }
        }
        return
      }

      // Ctrl+Shift+V → paste in place (no offset)
      if ((e.key === "v" || e.key === "V") && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        const clip = clipboardRef.current
        if (clip) {
          e.preventDefault()
          copyElementToSlide(doc.doc_id, clip.slideN, clip.elementId, selectedSlideRef.current, 0, 0)
            .then((el) => {
              markDirty(selectedSlideRef.current)
              setRefreshKey((k) => k + 1)
              setSelectedElement(el)
            })
            .catch((err) => console.error("paste in place failed:", err))
        }
        return
      }

      // Ctrl+V → paste element from clipboard onto current slide
      if ((e.key === "v" || e.key === "V") && (e.ctrlKey || e.metaKey)) {
        const clip = clipboardRef.current
        if (clip) {
          e.preventDefault()
          copyElementToSlide(doc.doc_id, clip.slideN, clip.elementId, selectedSlideRef.current)
            .then((el) => {
              markDirty(selectedSlideRef.current)
              setRefreshKey((k) => k + 1)
              setSelectedElement(el)
            })
            .catch((err) => console.error("paste failed:", err))
        } else {
          // Try to paste an image from the system clipboard
          const tag = (e.target as HTMLElement)?.tagName
          if (tag !== "INPUT" && tag !== "TEXTAREA") {
            e.preventDefault()
            navigator.clipboard.read().then(async (items) => {
              for (const item of items) {
                const imgType = item.types.find((t) => t.startsWith("image/"))
                if (imgType) {
                  const blob = await item.getType(imgType)
                  const ext = imgType.split("/")[1] ?? "png"
                  const file = new File([blob], `clipboard.${ext}`, { type: imgType })
                  try {
                    const el = await createImageElement(doc.doc_id, selectedSlideRef.current, file)
                    markDirty(selectedSlideRef.current)
                    setRefreshKey((k) => k + 1)
                    setSelectedElement(el)
                  } catch (err) { console.error("clipboard image paste failed:", err) }
                  break
                }
              }
            }).catch(() => {})
          }
        }
        return
      }

      // Ctrl+D → duplicate
      if ((e.key === "d" || e.key === "D") && (e.ctrlKey || e.metaKey)) {
        if (selectedElementRef.current) { e.preventDefault(); handleDuplicate() }
        return
      }

      // Ctrl+S → rebuild
      if ((e.key === "s" || e.key === "S") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        onRebuild()
        return
      }

      // Ctrl+H or Ctrl+F → find & replace
      if ((e.key === "h" || e.key === "H" || e.key === "f" || e.key === "F") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        setFindReplaceOpen((o) => !o)
        return
      }

      // ? → keyboard shortcuts help
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault()
        setShortcutsOpen((o) => !o)
        return
      }

      // Ctrl+K → command palette (jump to element)
      if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        setCommandPaletteOpen((o) => !o)
        return
      }

      // Ctrl+G → slide sorter grid view; Ctrl+Shift+G → storyboard
      if ((e.key === "g" || e.key === "G") && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault()
        setStoryboardOpen((o) => !o)
        return
      }
      if ((e.key === "g" || e.key === "G") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        setSlideSorterOpen((o) => !o)
        return
      }

      // Ctrl+Z → undo, Ctrl+Y or Ctrl+Shift+Z → redo
      if ((e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault()
        undoDoc(doc.doc_id).then((r) => {
          setSelectedElement(null)
          setUndoDepth(r.undo_depth)
          setRedoDepth(r.redo_depth)
          setRefreshKey((k) => k + 1)
        }).catch(() => {})
        return
      }
      if (((e.key === "y" || e.key === "Y") && (e.ctrlKey || e.metaKey)) ||
          ((e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey) && e.shiftKey)) {
        e.preventDefault()
        redoDoc(doc.doc_id).then((r) => {
          setSelectedElement(null)
          setUndoDepth(r.undo_depth)
          setRedoDepth(r.redo_depth)
          setRefreshKey((k) => k + 1)
        }).catch(() => {})
        return
      }

      // Ctrl+\ → toggle focus mode (hide side panels)
      if (e.key === "\\" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        setFocusMode((f) => !f)
        return
      }

      // Ctrl+B → toggle pin on current slide
      if ((e.key === "b" || e.key === "B") && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault()
        const cur = selectedSlideRef.current
        const isPinned = pinnedSlides.has(cur)
        pinSlide(doc.doc_id, cur, !isPinned)
          .then(() => setPinnedSlides((prev) => {
            const next = new Set(prev)
            if (isPinned) next.delete(cur); else next.add(cur)
            return next
          }))
          .catch(() => {})
        return
      }

      // Ctrl+Shift+B → jump to next pinned slide
      if ((e.key === "b" || e.key === "B") && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault()
        const pins = [...pinnedSlides].sort((a, b) => a - b)
        if (pins.length > 0) {
          const next = pins.find((n) => n > selectedSlideRef.current) ?? pins[0]
          setSelectedSlide(next)
          setSelectedElement(null)
        }
        return
      }

      // L → toggle lock on selected element
      if ((e.key === "l" || e.key === "L") && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const el = selectedElementRef.current
        if (el) { e.preventDefault(); handleToggleFlags(el.id, { locked: !el.locked }); return }
      }

      // Ctrl+T → insert text box on current slide
      if ((e.key === "t" || e.key === "T") && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault()
        handleInsertShape("text_box")
        return
      }

      // F5 → present from current slide
      if (e.key === "F5") {
        e.preventDefault()
        setPresenting(true)
        return
      }

      // PageUp → previous slide, PageDown → next slide, Home → first, End → last
      if (e.key === "PageUp") {
        e.preventDefault()
        setSelectedSlide((n) => Math.max(1, n - 1))
        setSelectedElement(null)
        return
      }
      if (e.key === "PageDown") {
        e.preventDefault()
        setSelectedSlide((n) => Math.min(localSlideCountRef.current, n + 1))
        setSelectedElement(null)
        return
      }

      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return
      const el = selectedElementRef.current
      if (!el || el.locked) return
      e.preventDefault()
      const step = e.shiftKey ? 1.0 : 0.1
      const dl = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0
      const dt = e.key === "ArrowUp"   ? -step : e.key === "ArrowDown"  ? step : 0
      handleCommitPosition(
        Math.max(0, el.left_in + dl),
        Math.max(0, el.top_in  + dt),
        el.width_in,
        el.height_in,
      )
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [handleCommitPosition, handleDelete, handleDuplicate, handleInsertShape, handleToggleFlags, pinnedSlides, doc.doc_id])

  const handleSlideSelect = useCallback((n: number) => {
    setSelectedSlide(n)
    setSelectedElement(null)
    setMultiSelectIds(new Set())
  }, [])

  const handleInsertImage = useCallback(async (file: File) => {
    try {
      const el = await createImageElement(doc.doc_id, selectedSlideRef.current, file)
      setSelectedElement(el)
      markDirty(selectedSlideRef.current)
      setRefreshKey((k) => k + 1)
    } catch (e) {
      console.error("insert image failed:", e)
    }
  }, [doc.doc_id, markDirty])

  const handleSlideCountChange = useCallback((newCount: number, focusSlide: number) => {
    setLocalSlideCount(newCount)
    setSelectedSlide(focusSlide)
    setSelectedElement(null)
    setRefreshKey((k) => k + 1)
  }, [])

  const handleJumpToElement = useCallback((slideN: number, _elementId: string) => {
    setSelectedSlide(slideN)
    setSelectedElement(null)
    setMultiSelectIds(new Set())
  }, [])

  const handleSplitElement = useCallback(async (elementId: string) => {
    try {
      const r = await splitElementToSlides(doc.doc_id, selectedSlideRef.current, elementId)
      handleSlideCountChange(r.new_slide_count, r.new_slide_ns[0] ?? selectedSlideRef.current + 1)
      setRefreshKey((k) => k + 1)
    } catch (e) {
      console.error("split element failed:", e)
    }
  }, [doc.doc_id])  // eslint-disable-line react-hooks/exhaustive-deps

  const handleOptimizeLayout = useCallback(async (goal: "balanced" | "emphasis-title" | "compact" | "spacious" = "balanced") => {
    setOptimizingLayout(true)
    try {
      const r = await optimizeSlideLayout(doc.doc_id, selectedSlideRef.current, goal)
      markDirty(selectedSlideRef.current)
      setSelectedElement(null)
      setRefreshKey((k) => k + 1)
      console.info(`AI layout optimizer: ${r.element_count} elements adjusted (goal: ${r.goal})`)
    } catch (e) {
      console.error("optimize layout failed:", e)
    } finally {
      setOptimizingLayout(false)
    }
  }, [doc.doc_id, markDirty])

  const handleRerenderAll = useCallback(async () => {
    setRerenderingAll(true)
    try {
      await rerenderAllSlides(doc.doc_id)
      setRefreshKey((k) => k + 1)
    } catch (e) {
      console.error("rerender-all failed:", e)
    } finally {
      setRerenderingAll(false)
    }
  }, [doc.doc_id])

  const handleSaveToCloud = useCallback(async () => {
    setSavingToCloud(true)
    try {
      const res = await api.saveToCloud(doc.doc_id)
      if (res.version_archived) {
        console.info("Previous bundle archived at:", res.version_archived)
      }
    } catch (e) {
      console.error("Save to cloud failed:", e)
    } finally {
      setSavingToCloud(false)
    }
  }, [doc.doc_id])

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      {/* ── toolbar ──────────────────────────────────────── */}
      <StudioRibbon
        doc={{ ...doc, slide_count: localSlideCount }}
        slideN={selectedSlide}
        slideWidthIn={slideWidthIn}
        slideHeightIn={slideHeightIn}
        selectedElement={selectedElement}
        onCommitPosition={handleCommitPosition}
        onCommitZIndex={handleCommitZIndex}
        onDelete={handleDelete}
        onDuplicate={handleDuplicate}
        onInsertShape={handleInsertShape}
        onInsertImage={handleInsertImage}
        onRebuild={() => { setDirtySlides(new Set()); onRebuild() }}
        rebuilding={rebuilding}
        chatOpen={!agentCollapsed}
        onToggleChat={() => {
          const next = !agentCollapsed
          setAgentCollapsed(next)
          saveAgentCollapsed(next)
        }}
        findReplaceOpen={findReplaceOpen}
        onToggleFindReplace={() => setFindReplaceOpen((o) => !o)}
        onSaveToCloud={doc.cloud_bundle_uri ? handleSaveToCloud : undefined}
        savingToCloud={savingToCloud}
        undoDepth={undoDepth}
        redoDepth={redoDepth}
        onUndo={() => undoDoc(doc.doc_id).then((r) => { setSelectedElement(null); setUndoDepth(r.undo_depth); setRedoDepth(r.redo_depth); setRefreshKey((k) => k + 1) }).catch(() => {})}
        onRedo={() => redoDoc(doc.doc_id).then((r) => { setSelectedElement(null); setUndoDepth(r.undo_depth); setRedoDepth(r.redo_depth); setRefreshKey((k) => k + 1) }).catch(() => {})}
        onShowShortcuts={() => setShortcutsOpen(true)}
        onShowSlideSorter={() => setSlideSorterOpen(true)}
        onShowOutlineGen={() => setOutlineGenOpen(true)}
        multiSelectIds={multiSelectIds}
        onAlignElements={handleAlignElements}
        onFormatPaint={handleFormatPaint}
        formatPaintMode={formatPaintMode}
        onCopyToSlide={selectedElement ? handleCopyToSlide : undefined}
        onApplyLayout={handleApplyLayout}
        onGroupElements={multiSelectIds.size > 1 ? handleGroupElements : undefined}
        onUngroupElement={selectedElement?.type === "BridgeGroup" ? handleUngroupElement : undefined}
        onGenerateSlide={handleGenerateSlide}
        generating={generating}
        outlineOpen={outlineOpen}
        onToggleOutline={() => setOutlineOpen((o) => !o)}
        onPresent={() => setPresenting(true)}
        layersOpen={layersOpen}
        onToggleLayers={() => setLayersOpen((o) => !o)}
        onRerenderAll={handleRerenderAll}
        rerenderingAll={rerenderingAll}
        onColorSwap={() => setColorSwapOpen(true)}
        onFontSwap={() => setFontSwapOpen(true)}
        onNotesReview={() => setNotesReviewOpen(true)}
        onTemplateVars={() => setTemplateVarsOpen(true)}
        onAgendaSlide={() => setAgendaSlideOpen(true)}
        onAIScore={() => setAiScoreOpen(true)}
        onShare={() => setShareOpen(true)}
        colorBlindMode={colorBlindMode}
        onSetColorBlindMode={setColorBlindMode}
        onSlideNumbers={() => setSlideNumbersOpen(true)}
        onWatermark={() => setWatermarkOpen(true)}
        onTransitions={() => setTransitionsOpen(true)}
        onOptimizeLayout={handleOptimizeLayout}
        optimizingLayout={optimizingLayout}
        onCompare={() => setCompareOpen(true)}
        onGrammarCheck={() => setGrammarOpen(true)}
        onThemeGen={() => setThemeGenOpen(true)}
        onVariation={() => setVariationOpen(true)}
        onTranslate={() => setTranslateOpen(true)}
        onShowStats={() => setStatsOpen(true)}
        onShowCheck={() => setCheckOpen(true)}
        commentsOpen={commentsOpen}
        onToggleComments={() => setCommentsOpen((o) => !o)}
        onImportSlides={async (file) => {
          try {
            const r = await importSlides(doc.doc_id, file)
            handleSlideCountChange(r.slide_count, r.slide_count)
            setRefreshKey((k) => k + 1)
          } catch (e) { console.error("import slides failed:", e) }
        }}
        onBulkFillColor={multiSelectIds.size > 1 ? async (color) => {
          try {
            await bulkUpdateStyle(doc.doc_id, selectedSlideRef.current, [...multiSelectIds], { fill_color: color, fill_type: "solid" })
            markDirty(selectedSlideRef.current)
            setRefreshKey((k) => k + 1)
          } catch (e) { console.error("bulk fill failed:", e) }
        } : undefined}
        onGenerateNotesBulk={async () => {
          try {
            const r = await generateNotesBulk(doc.doc_id)
            setRefreshKey((k) => k + 1)
            toast.success(`Generated notes for ${r.generated} slide${r.generated !== 1 ? "s" : ""}${r.skipped > 0 ? ` · ${r.skipped} skipped` : ""}`)
          } catch (e) { console.error("bulk notes failed:", e) }
        }}
        onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        onTextFormatCommit={rerender}
      />

      {/* ── main area: slide strip + canvas + properties ── */}
      <div className="flex flex-1 min-h-0 min-w-0 relative">
        {!focusMode && outlineOpen && (
          <OutlinePanel
            docId={doc.doc_id}
            slideCount={localSlideCount}
            selectedSlide={selectedSlide}
            refreshKey={refreshKey}
            onJumpToSlide={handleSlideSelect}
          />
        )}
        {!focusMode && <StudioSlideStrip
          docId={doc.doc_id}
          slideCount={localSlideCount}
          selectedSlide={selectedSlide}
          dirtySlides={dirtySlides}
          refreshKey={refreshKey}
          pinnedSlides={pinnedSlides}
          onPinChange={(n, pinned) => setPinnedSlides((prev) => {
            const next = new Set(prev)
            if (pinned) next.add(n); else next.delete(n)
            return next
          })}
          onSelect={handleSlideSelect}
          onSlideCountChange={handleSlideCountChange}
        />}

        <div className="flex flex-col flex-1 min-h-0 min-w-0">
          <StudioCanvas
            docId={doc.doc_id}
            slideN={selectedSlide}
            slideWidthIn={slideWidthIn}
            slideHeightIn={slideHeightIn}
            refreshKey={refreshKey}
            onSelectElement={setSelectedElement}
            onMultiSelect={setMultiSelectIds}
            onDeleteElement={handleDeleteById}
            onDuplicateElement={async (id) => {
              const el = slideElements.find((e) => e.id === id)
              if (!el) return
              try {
                const dup = await duplicateElementApi(doc.doc_id, selectedSlideRef.current, id)
                setSelectedElement(dup)
                markDirty(selectedSlideRef.current)
                setRefreshKey((k) => k + 1)
              } catch (e) { console.error("duplicate failed:", e) }
            }}
            onToggleLockElement={(id, locked) => handleToggleFlags(id, { locked })}
            onToggleHiddenElement={(id, hidden) => handleToggleFlags(id, { hidden })}
            onZIndexChange={() => { markDirty(selectedSlideRef.current); setRefreshKey((k) => k + 1) }}
            onGroupElements={multiSelectIds.size > 1 ? handleGroupElements : undefined}
            onUngroupElement={selectedElement?.type === "BridgeGroup" ? handleUngroupElement : undefined}
            focusMode={focusMode}
            onToggleFocusMode={() => setFocusMode((f) => !f)}
            colorBlindMode={colorBlindMode}
            onSlideContextMenu={(x, y) => setSlideCtxMenu({ x, y })}
            onBroadcastElement={(pushedTo) => {
              markDirty(selectedSlideRef.current)
              setRefreshKey((k) => k + 1)
              console.info(`Broadcast pushed element to ${pushedTo} slides`)
            }}
            onSplitElement={handleSplitElement}
            onEditConnect={(id) => setConnectModalElementId(id)}
            connectIds={connectIdsThisSlide}
          />
          <StudioNotesBar docId={doc.doc_id} slideN={selectedSlide} />

          {/* status bar — PPT style: info left, view buttons right */}
          <div className="h-7 shrink-0 border-t border-gray-300 bg-white flex items-center px-3 gap-2 text-[11px] text-gray-500 select-none" style={{ fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
            {/* slide N/M */}
            <span className="shrink-0">
              Slide <span className="text-gray-800 font-medium">{selectedSlide}</span> of {localSlideCount}
            </span>
            <span className="text-gray-300">|</span>
            <span className="shrink-0">{slideElements.length} object{slideElements.length !== 1 ? "s" : ""}</span>
            {selectedElement && (
              <>
                <span className="text-gray-300">|</span>
                <span className="text-gray-700 truncate max-w-[14rem]">{selectedElement.name}</span>
              </>
            )}
            {multiSelectIds.size > 1 && (
              <>
                <span className="text-gray-300">|</span>
                <span className="text-gray-700">{multiSelectIds.size} selected</span>
              </>
            )}
            {remoteUserCount > 0 && (
              <>
                <span className="text-gray-300">|</span>
                <span className="text-emerald-600 text-[10px]">
                  ● {remoteUserCount} {remoteUserCount === 1 ? "collaborator" : "collaborators"}
                </span>
              </>
            )}
            <div className="flex-1" />
            {docConnects.length > 0 && (
              <span title="Bound elements with Python connects" className="text-[10px] text-blue-600 shrink-0">
                {docConnects.length} connect{docConnects.length !== 1 ? "s" : ""}
              </span>
            )}
            <span className="text-gray-400 text-[10px] shrink-0">{slideWidthIn.toFixed(1)}" × {slideHeightIn.toFixed(1)}"</span>
            <span className="text-gray-300">|</span>
            {/* View mode buttons — Normal | Sorter | Reading (PPT status bar style) */}
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                title="Normal view"
                onClick={() => setFocusMode(false)}
                className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${!focusMode ? "text-[#2b579a] bg-[#2b579a]/10" : "text-gray-500 hover:text-gray-700"}`}
              >
                ⊞ Normal
              </button>
              <button
                title="Slide Sorter"
                onClick={() => setSlideSorterOpen(true)}
                className="px-1.5 py-0.5 rounded text-[10px] text-gray-500 hover:text-gray-700 transition-colors"
              >
                ▦ Sorter
              </button>
              <button
                title="Focus mode (hide panels)"
                onClick={() => setFocusMode((f) => !f)}
                className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${focusMode ? "text-[#2b579a] bg-[#2b579a]/10" : "text-gray-500 hover:text-gray-700"}`}
              >
                ⛶ Focus
              </button>
            </div>
          </div>

          {/* slide progress bar — click to jump proportionally */}
          {localSlideCount > 1 && (
            <div
              className="h-0.5 bg-white/5 shrink-0 relative cursor-pointer group"
              title={`Slide ${selectedSlide} of ${localSlideCount}`}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                const pct = (e.clientX - rect.left) / rect.width
                const target = Math.max(1, Math.min(localSlideCount, Math.round(pct * localSlideCount)))
                setSelectedSlide(target)
                setSelectedElement(null)
              }}
            >
              <div
                className="h-full bg-paper/40 group-hover:bg-paper transition-all"
                style={{ width: `${(selectedSlide / localSlideCount) * 100}%` }}
              />
              {pinnedSlides.size > 0 && [...pinnedSlides].map((n) => (
                <div
                  key={n}
                  className="absolute top-0 h-full w-0.5 bg-champagne/70"
                  style={{ left: `${((n - 0.5) / localSlideCount) * 100}%` }}
                  title={`Pinned: slide ${n}`}
                />
              ))}
            </div>
          )}
        </div>

        {!focusMode && layersOpen && (
          <LayersPanel
            docId={doc.doc_id}
            slideN={selectedSlide}
            elements={slideElements}
            selectedIds={multiSelectIds.size > 0 ? multiSelectIds : selectedElement ? new Set([selectedElement.id]) : new Set()}
            onSelect={(id, multi) => {
              if (multi) {
                setMultiSelectIds((prev) => {
                  const next = new Set(prev)
                  if (next.has(id)) next.delete(id); else next.add(id)
                  return next
                })
              } else {
                const el = slideElements.find((e) => e.id === id) ?? null
                setSelectedElement(el)
                setMultiSelectIds(el ? new Set([id]) : new Set())
              }
            }}
            onToggleLock={(id, locked) => handleToggleFlags(id, { locked })}
            onToggleHidden={(id, hidden) => handleToggleFlags(id, { hidden })}
            onReorder={() => setRefreshKey((k) => k + 1)}
          />
        )}

        {!focusMode && <StudioPropertiesPanel
          element={selectedElement}
          elements={slideElements}
          multiSelectIds={multiSelectIds}
          slideN={selectedSlide}
          slideWidthIn={slideWidthIn}
          slideHeightIn={slideHeightIn}
          docId={doc.doc_id}
          onTextCommit={rerender}
          onSelectElement={setSelectedElement}
          onDeleteElement={handleDeleteById}
          onToggleLock={(id, locked) => handleToggleFlags(id, { locked })}
          onToggleHidden={(id, hidden) => handleToggleFlags(id, { hidden })}
          onEditConnect={(id) => setConnectModalElementId(id)}
          collapsed={propsManualOverride !== null
            ? propsManualOverride
            : !selectedElement && (multiSelectIds?.size ?? 0) < 2}
          onToggleCollapsed={(c) => {
            setPropsManualOverride(c)
            try { localStorage.setItem("percy_props_collapsed_v1", String(c)) } catch {}
          }}
        />}

        <StudioAgent
          docId={doc.doc_id}
          slideN={selectedSlide}
          selectedElement={selectedElement}
          collapsed={agentCollapsed}
          onToggleCollapsed={(c) => { setAgentCollapsed(c); saveAgentCollapsed(c) }}
          onRefresh={() => setRefreshKey((k) => k + 1)}
          onJumpToSlide={(n) => handleSlideSelect(n)}
          onEditConnect={(id) => setConnectModalElementId(id)}
          refreshTick={refreshKey}
        />

        {connectModalElementId && (() => {
          const el = slideElements.find((e) => e.id === connectModalElementId)
          if (!el) return null
          return (
            <ConnectModal
              docId={doc.doc_id}
              slideN={selectedSlide}
              element={el}
              onClose={() => setConnectModalElementId(null)}
            />
          )
        })()}

        {findReplaceOpen && (
          <FindReplacePanel
            docId={doc.doc_id}
            onClose={() => setFindReplaceOpen(false)}
            onJumpToSlide={(n, elementId) => {
              setSelectedSlide(n)
              if (elementId) {
                fetchSlideElements(doc.doc_id, n)
                  .then((r) => {
                    const el = r.elements.find((e) => e.id === elementId) ?? null
                    setSelectedElement(el)
                  })
                  .catch(() => setSelectedElement(null))
              } else {
                setSelectedElement(null)
              }
            }}
            onReplaced={() => setRefreshKey((k) => k + 1)}
          />
        )}
      </div>

      {shortcutsOpen && (
        <KeyboardShortcutsModal onClose={() => setShortcutsOpen(false)} />
      )}

      {commandPaletteOpen && (
        <CommandPalette
          docId={doc.doc_id}
          onClose={() => setCommandPaletteOpen(false)}
          onJump={handleJumpToElement}
          actions={[
            { id: "find-replace", label: "Find & Replace", icon: "🔄", keywords: ["search", "text", "replace"], run: () => setFindReplaceOpen(true) },
            { id: "present", label: "Start Presentation", icon: "▶", keywords: ["present", "slideshow", "fullscreen"], run: () => setPresenting(true) },
            { id: "presentation-check", label: "Presentation Check", icon: "✓", keywords: ["check", "audit", "quality", "issues"], run: () => setCheckOpen(true) },
            { id: "slide-sorter", label: "Slide Sorter", icon: "⊞", keywords: ["sort", "reorder", "organize"], run: () => setSlideSorterOpen(true) },
            { id: "stats", label: "Document Stats", icon: "📊", keywords: ["statistics", "word count", "elements"], run: () => setStatsOpen(true) },
            { id: "color-swap", label: "Color Swap", icon: "🎨", keywords: ["color", "replace", "theme"], run: () => setColorSwapOpen(true) },
            { id: "font-swap", label: "Font Swap", icon: "🔤", keywords: ["font", "typeface", "replace", "typography"], run: () => setFontSwapOpen(true) },
            { id: "notes-review", label: "Notes Review", icon: "📝", keywords: ["notes", "speaker", "script", "review", "edit"], run: () => setNotesReviewOpen(true) },
            { id: "template-vars", label: "Template Variables", icon: "⚙", keywords: ["template", "variables", "placeholder", "replace", "fill"], run: () => setTemplateVarsOpen(true) },
            { id: "agenda-slide", label: "Insert Agenda Slide", icon: "☰", keywords: ["agenda", "toc", "table of contents", "outline", "insert"], run: () => setAgendaSlideOpen(true) },
            { id: "ai-score", label: "AI Presentation Score", icon: "✨", keywords: ["ai", "score", "quality", "feedback", "grade", "rate"], run: () => setAiScoreOpen(true) },
            { id: "slide-numbers", label: "Add Slide Numbers", icon: "123", keywords: ["slide", "numbers", "numbering", "page", "footer"], run: () => setSlideNumbersOpen(true) },
            { id: "watermark", label: "Add Watermark", icon: "⌀", keywords: ["watermark", "confidential", "draft", "stamp"], run: () => setWatermarkOpen(true) },
            { id: "transitions", label: "Slide Transitions", icon: "↻", keywords: ["transition", "animation", "fade", "slide", "effect", "between"], run: () => setTransitionsOpen(true) },
            { id: "compare", label: "Before / After Comparer", icon: "⇔", keywords: ["compare", "original", "before", "after", "diff", "side by side"], run: () => setCompareOpen(true) },
            { id: "grammar-check", label: "Grammar & Clarity Check (AI)", icon: "✓", keywords: ["grammar", "spelling", "clarity", "check", "proofread", "errors", "text"], run: () => setGrammarOpen(true) },
            { id: "theme-gen", label: "AI Theme Generator", icon: "🎨", keywords: ["theme", "color", "palette", "generate", "ai", "brand", "style", "design"], run: () => setThemeGenOpen(true) },
            { id: "slide-variation", label: "AI Slide Variations (rewrite current slide)", icon: "✦", keywords: ["ai", "variation", "variant", "rewrite", "rephrase", "tone", "persuasive", "concise", "executive", "casual", "alternate"], run: () => setVariationOpen(true) },
            { id: "translate", label: "AI Translate Slides", icon: "🌐", keywords: ["translate", "language", "localize", "spanish", "french", "german", "chinese", "japanese", "international", "i18n"], run: () => setTranslateOpen(true) },
            { id: "auto-sections", label: "AI Auto-Detect Sections", icon: "§", keywords: ["ai", "sections", "groups", "chapters", "organize", "auto", "detect", "structure"], run: async () => { try { const r = await autoDetectSections(doc.doc_id); const count = Object.keys(r.sections).length; setRefreshKey((k) => k + 1); alert(`Created ${count} section${count !== 1 ? "s" : ""} across ${r.total_slides} slides`) } catch (e) { console.error("auto-sections failed:", e) } } },
            { id: "reorder-suggest", label: "AI Suggest Slide Reorder", icon: "✦", keywords: ["ai", "reorder", "rearrange", "order", "flow", "structure", "narrative", "optimize"], run: () => setReorderOpen(true) },
            { id: "fit-text", label: "Fit Text to Boxes (current slide)", icon: "↔", keywords: ["fit", "text", "overflow", "font", "size", "shrink", "auto", "resize"], run: async () => { try { const r = await fitTextToElements(doc.doc_id, selectedSlide); if (r.fitted.length > 0) { markDirty(selectedSlide); setRefreshKey((k) => k + 1) }; alert(r.fitted.length > 0 ? `Adjusted font size on ${r.fitted.length} element${r.fitted.length !== 1 ? "s" : ""}` : "All text already fits within bounds") } catch (e) { console.error("fit-text failed:", e) } } },
            { id: "similar-slides", label: "Find Similar / Duplicate Slides", icon: "⊕", keywords: ["similar", "duplicate", "duplicate slides", "repeated", "redundant", "find", "detect"], run: () => setSimilarOpen(true) },
            { id: "brand-check", label: "Brand Consistency Checker", icon: "◈", keywords: ["brand", "consistency", "colors", "fonts", "guidelines", "compliance", "check", "audit"], run: () => setBrandCheckOpen(true) },
            { id: "content-density", label: "Slide Content Density Report", icon: "▦", keywords: ["density", "word count", "crowded", "sparse", "content", "balance", "heatmap"], run: () => setDensityOpen(true) },
            { id: "optimize-images", label: "Optimize Images (reduce file size)", icon: "⌁", keywords: ["image", "optimize", "compress", "resize", "size", "reduce", "jpeg"], run: async () => { try { const r = await optimizeImages(doc.doc_id); alert(r.total_optimized > 0 ? `Compressed ${r.total_optimized} image${r.total_optimized !== 1 ? "s" : ""}, saved ${r.saved_kb} KB (${r.saved_pct}%)` : "No images needed optimization") } catch (e) { console.error("optimize-images failed:", e) } } },
            { id: "readability", label: "Readability Score Report", icon: "📖", keywords: ["readability", "flesch", "reading", "ease", "score", "grade", "difficulty", "text"], run: () => setReadabilityOpen(true) },
            { id: "deck-health", label: "Deck Health Dashboard", icon: "❤", keywords: ["health", "dashboard", "quality", "overview", "score", "audit", "check", "summary"], run: () => setDeckHealthOpen(true) },
            { id: "rehearsal-timer", label: "Rehearsal Timer (practice timing)", icon: "⏱", keywords: ["rehearsal", "timer", "practice", "timing", "speak", "present", "pace", "clock"], run: () => setRehearsalOpen(true) },
            { id: "snapshots", label: "Snapshot Manager (save/restore checkpoints)", icon: "📷", keywords: ["snapshot", "checkpoint", "save", "restore", "version", "backup", "history"], run: () => setSnapshotOpen(true) },
            { id: "voiceover-script", label: "AI Voiceover Script Generator", icon: "✦", keywords: ["ai", "voiceover", "narration", "script", "speak", "audio", "record", "talk", "read"], run: () => setVoiceoverOpen(true) },
            { id: "alt-text", label: "AI Generate Alt Text for Images (accessibility)", icon: "♿", keywords: ["ai", "alt", "text", "accessibility", "image", "description", "screen reader", "wcag"], run: async () => { try { const r = await generateAltTextBulk(doc.doc_id); alert(`Generated alt text for ${r.updated} image${r.updated !== 1 ? "s" : ""}${r.skipped > 0 ? ` (${r.skipped} skipped)` : ""}`) } catch (e) { console.error("alt-text failed:", e) } } },
            { id: "deck-summary", label: "AI Deck Summarizer (executive overview)", icon: "✦", keywords: ["ai", "summary", "overview", "executive", "brief", "summarize", "abstract", "report"], run: () => setDeckSummaryOpen(true) },
            { id: "slide-diff", label: "Slide Text Diff (compare two slides)", icon: "⊖", keywords: ["diff", "compare", "difference", "text", "changes", "before", "after", "delta"], run: () => setSlideDiffOpen(true) },
            { id: "action-items", label: "AI Extract Action Items & Tasks", icon: "✦", keywords: ["ai", "action", "items", "tasks", "todo", "follow-up", "owner", "deadline", "extract"], run: () => setActionItemsOpen(true) },
            { id: "keywords", label: "Keyword Cloud / Topic Extraction", icon: "◈", keywords: ["keyword", "cloud", "topics", "theme", "words", "frequency", "analysis", "terms", "vocabulary"], run: () => setKeywordsOpen(true) },
            { id: "question-generator", label: "AI Question Generator (discussion / quiz)", icon: "✦", keywords: ["ai", "questions", "quiz", "discussion", "comprehension", "test", "training", "education", "generate"], run: () => setQuestionsOpen(true) },
            { id: "presentation-coach", label: "AI Presentation Coach (structure & pacing)", icon: "✦", keywords: ["ai", "coach", "coaching", "structure", "pacing", "delivery", "flow", "tips", "advice", "feedback"], run: () => setCoachOpen(true) },
            { id: "title-optimizer", label: "AI Title Optimizer (improve slide titles)", icon: "✦", keywords: ["ai", "title", "optimize", "improve", "heading", "punch", "concise", "rewrite"], run: () => setTitleOptOpen(true) },
            { id: "storyboard", label: "Storyboard View (thumbnail grid)", icon: "▦", keywords: ["storyboard", "thumbnail", "grid", "overview", "all slides", "gallery", "layout"], run: () => setStoryboardOpen(true) },
            { id: "layout-issues", label: "Layout Issues Detector (out-of-bounds, overlaps)", icon: "⛔", keywords: ["layout", "issues", "overlap", "bounds", "fix", "detect", "position", "size"], run: () => setLayoutIssuesOpen(true) },
            { id: "audience-adapter", label: "AI Audience Adapter (rewrite for target audience)", icon: "✦", keywords: ["ai", "audience", "adapt", "rewrite", "tone", "executive", "technical", "tailor", "simplify"], run: () => setAudienceAdaptOpen(true) },
            { id: "style-audit", label: "Style Audit (fonts, sizes, colors used)", icon: "◉", keywords: ["style", "audit", "fonts", "colors", "sizes", "consistency", "brand", "design", "palette"], run: () => setStyleAuditOpen(true) },
            { id: "insert-toc", label: "Insert Table of Contents Slide", icon: "☰", keywords: ["toc", "table", "contents", "outline", "index", "navigation", "insert", "slide"], run: async () => { try { const r = await insertToc(doc.doc_id, "Table of Contents", 1, "dark"); handleSlideCountChange(r.slide_count, r.new_slide_n); setRefreshKey((k) => k + 1) } catch (e) { console.error("insert-toc failed:", e) } } },
            { id: "timer-budget", label: "Timer Budget (distribute presentation time)", icon: "⏱", keywords: ["timer", "budget", "time", "duration", "schedule", "rehearsal", "minutes", "pace"], run: () => setTimerBudgetOpen(true) },
            { id: "reading-level", label: "Reading Level (Flesch-Kincaid per slide)", icon: "📖", keywords: ["reading", "level", "flesch", "kincaid", "grade", "complexity", "comprehension", "ease"], run: () => setReadingLevelOpen(true) },
            { id: "text-case", label: "Text Case Changer (UPPER / lower / Title / Sentence)", icon: "Aa", keywords: ["text", "case", "uppercase", "lowercase", "title", "sentence", "transform", "capitalize"], run: () => setTextCaseOpen(true) },
            { id: "impact-scores", label: "AI Impact Scores (memorability rating per slide)", icon: "✦", keywords: ["ai", "impact", "score", "memorability", "rating", "effectiveness", "slide", "quality"], run: () => setImpactScoresOpen(true) },
            { id: "emotional-tone", label: "AI Emotional Tone Analyzer", icon: "✦", keywords: ["ai", "emotion", "tone", "mood", "feeling", "inspiring", "urgent", "calm", "analytical"], run: () => setEmotionalToneOpen(true) },
            { id: "image-gallery", label: "Image Gallery (all deck images)", icon: "◻", keywords: ["images", "gallery", "pictures", "photos", "visual", "media", "assets"], run: () => setImageGalleryOpen(true) },
            { id: "accessibility", label: "Accessibility Report (alt text, contrast, font size)", icon: "♿", keywords: ["accessibility", "a11y", "alt", "contrast", "wcag", "screen reader", "font"], run: () => setAccessibilityOpen(true) },
            { id: "auto-tag", label: "AI Auto-Tag Slides (topic tags)", icon: "✦", keywords: ["ai", "tag", "topic", "category", "label", "classify", "organize"], run: () => setAutoTagOpen(true) },
            { id: "cover-slide", label: "Generate Cover Slide (title, subtitle, author)", icon: "◻", keywords: ["cover", "title", "slide", "insert", "header", "author", "subtitle", "create"], run: () => setCoverSlideOpen(true) },
            { id: "export-outline-md", label: "Export Deck Outline (Markdown)", icon: "⬇", keywords: ["export", "outline", "markdown", "download", "structure", "index"], run: () => { const a = document.createElement("a"); a.href = outlineExportUrl(doc.doc_id, "md"); a.download = "outline.md"; a.click() } },
            { id: "export-notes-md", label: "Export Speaker Notes (Markdown)", icon: "⬇", keywords: ["export", "notes", "speaker", "markdown", "download"], run: () => { const a = document.createElement("a"); a.href = notesExportUrl(doc.doc_id, "md"); a.download = "notes.md"; a.click() } },
            { id: "progress-bar", label: "Progress Bar (reading indicator on all slides)", icon: "▬", keywords: ["progress", "bar", "indicator", "reading", "slide", "stripe", "insert"], run: () => setProgressBarOpen(true) },
            { id: "preflight", label: "Pre-Flight Check (review before presenting)", icon: "✓", keywords: ["preflight", "check", "review", "ready", "present", "prepare", "qa", "quality"], run: () => setPreflightOpen(true) },
            { id: "hook-writer", label: "AI Hook Writer (engaging opening for current slide)", icon: "✦", keywords: ["ai", "hook", "opening", "question", "statistic", "engage", "intro"], run: () => setHookWriterOpen(true) },
            { id: "conclusion-slide", label: "AI Generate Conclusion Slide (key takeaways + CTA)", icon: "✦", keywords: ["ai", "conclusion", "takeaway", "summary", "cta", "closing", "end", "final", "insert"], run: async () => { try { const r = await generateConclusionSlide(doc.doc_id); handleSlideCountChange(r.slide_count, r.new_slide_n); setSelectedSlide(r.new_slide_n); setRefreshKey((k) => k + 1) } catch (e) { console.error("conclusion-slide failed:", e) } } },
            { id: "section-separator", label: "Insert Section Separator Slide", icon: "▬", keywords: ["section", "separator", "divider", "insert", "slide", "header", "part"], run: () => setSectionSepOpen(true) },
            { id: "format-presets", label: "Quick Format Presets (normalize fonts & colors)", icon: "◉", keywords: ["format", "preset", "normalize", "fonts", "colors", "corporate", "executive", "startup", "style"], run: () => setFormatPresetsOpen(true) },
            { id: "duplicate-finder", label: "Duplicate Content Finder (near-identical slides)", icon: "⚠", keywords: ["duplicate", "similar", "repeated", "copy", "redundant", "overlap", "content"], run: () => setDuplicateFinderOpen(true) },
            { id: "notes-expand", label: "Speaker Notes Auto-Expand (AI)", icon: "✦", keywords: ["notes", "expand", "speaker", "ai", "bullets", "paragraph", "write", "talking"], run: () => setNotesExpandOpen(true) },
            { id: "complexity", label: "Slide Complexity Score (density analysis)", icon: "▓", keywords: ["complexity", "density", "crowded", "overloaded", "stuffed", "busy", "score", "elements"], run: () => setComplexityOpen(true) },
            { id: "content-gaps", label: "Content Gap Detector (missing topics)", icon: "◎", keywords: ["gaps", "missing", "topics", "content", "coverage", "outline", "ai", "review"], run: () => setContentGapsOpen(true) },
            { id: "glossary", label: "Glossary Extractor (domain terms)", icon: "📖", keywords: ["glossary", "terms", "definitions", "jargon", "technical", "vocabulary", "extract"], run: () => setGlossaryOpen(true) },
            { id: "title-generator", label: "AI Slide Title Generator", icon: "✦", keywords: ["title", "heading", "ai", "generate", "rewrite", "name", "label"], run: () => setTitleGenOpen(true) },
            { id: "layout-analyzer", label: "Layout Analyzer (alignment & bounds)", icon: "⊡", keywords: ["layout", "alignment", "bounds", "overlap", "position", "misaligned", "out of bounds"], run: () => setLayoutAnalyzerOpen(true) },
            { id: "speaking-pace", label: "Speaking Pace Estimator (WPM)", icon: "⏱", keywords: ["speaking", "pace", "time", "wpm", "words", "minutes", "talk", "estimate"], run: () => setSpeakingPaceOpen(true) },
            { id: "thumbnails-zip", label: "Download Slide Thumbnails (ZIP)", icon: "⬇", keywords: ["download", "thumbnails", "zip", "images", "export", "png"], run: () => { const a = document.createElement("a"); a.href = thumbnailsZipUrl(doc.doc_id); a.download = "slides.zip"; a.click() } },
            { id: "citation-tracker", label: "Citation Tracker (find uncited claims)", icon: "📌", keywords: ["citations", "sources", "references", "claims", "stats", "quotes", "fact-check"], run: () => setCitationOpen(true) },
            { id: "contrast-checker", label: "Contrast Checker (WCAG accessibility)", icon: "◑", keywords: ["contrast", "wcag", "accessibility", "color", "legibility", "ratio", "text"], run: () => setContrastOpen(true) },
            { id: "qa-prep", label: "Q&A Prep (AI audience questions)", icon: "❓", keywords: ["qa", "questions", "audience", "prep", "answers", "prepare", "predict"], run: () => setQaPrepOpen(true) },
            { id: "slide-summarizer", label: "AI Slide Summarizer (one sentence per slide)", icon: "✦", keywords: ["summarize", "summary", "brief", "one sentence", "tldr", "ai", "abstract"], run: () => setSlideSummarizerOpen(true) },
            { id: "note-template", label: "Speaker Note Templates (intro/main/cta)", icon: "📋", keywords: ["notes", "template", "speaker", "intro", "cta", "main", "transition", "data"], run: () => setNoteTemplateOpen(true) },
            { id: "keyword-spotlight", label: "Keyword Spotlight (find across all slides)", icon: "🔦", keywords: ["keyword", "search", "find", "spotlight", "highlight", "locate", "word"], run: () => setKeywordSpotlightOpen(true) },
            { id: "text-stats", label: "Text Statistics (word count, sentences, density)", icon: "📊", keywords: ["text", "stats", "statistics", "words", "count", "sentences", "density", "analytics"], run: () => setTextStatsOpen(true) },
            { id: "emoji-remover", label: "Emoji Remover (strip all emoji from text)", icon: "🚫", keywords: ["emoji", "remove", "strip", "clean", "icons", "symbols"], run: () => setEmojiRemoverOpen(true) },
            { id: "capitalize-titles", label: "Capitalize Titles (Title Case / Sentence / CAPS)", icon: "Aa", keywords: ["capitalize", "title case", "uppercase", "sentence case", "caps", "heading"], run: () => setCapitalizeTitlesOpen(true) },
            { id: "pull-quotes", label: "Pull Quote Highlighter (AI best lines)", icon: "❝", keywords: ["pull quote", "quotable", "highlight", "best line", "memorable", "ai"], run: () => setPullQuoteOpen(true) },
            { id: "flow-feedback", label: "Deck Flow Feedback (narrative arc review)", icon: "〜", keywords: ["flow", "narrative", "arc", "structure", "feedback", "story", "opening", "closing", "ai"], run: () => setFlowFeedbackOpen(true) },
            { id: "footnote", label: "Add Footnote (small text at slide bottom)", icon: "†", keywords: ["footnote", "source", "citation", "small text", "bottom", "reference"], run: () => setFootnoteOpen(true) },
            { id: "word-cloud", label: "Slide Word Cloud (frequency visualization)", icon: "☁", keywords: ["word cloud", "frequency", "words", "visualization", "cloud", "heatmap"], run: () => setWordCloudOpen(true) },
            { id: "color-palette", label: "Color Palette (all deck colors)", icon: "🎨", keywords: ["color", "palette", "colors", "hex", "rgb", "scheme", "swatches"], run: () => setColorPaletteOpen(true) },
            { id: "slide-labels", label: "Slide Labels (custom categories)", icon: "🏷", keywords: ["labels", "categories", "tags", "custom", "organize", "mark"], run: () => setSlideLabelsOpen(true) },
            { id: "text-export-txt", label: "Export All Text (TXT download)", icon: "⬇", keywords: ["export", "text", "download", "all text", "plain text", "txt"], run: () => { const a = document.createElement("a"); a.href = textExportUrl(doc.doc_id, false, "txt"); a.download = "deck-text.txt"; a.click() } },
            { id: "text-export-md", label: "Export All Text (Markdown download)", icon: "⬇", keywords: ["export", "text", "download", "all text", "markdown", "md"], run: () => { const a = document.createElement("a"); a.href = textExportUrl(doc.doc_id, false, "md"); a.download = "deck-text.md"; a.click() } },
            { id: "deck-title", label: "Deck Title Suggester (AI)", icon: "✦", keywords: ["title", "deck title", "presentation name", "heading", "ai", "suggest"], run: () => setDeckTitleOpen(true) },
            { id: "blank-slides", label: "Blank Slide Detector (empty slides)", icon: "□", keywords: ["blank", "empty", "sparse", "no content", "missing", "slides"], run: () => setBlankSlideOpen(true) },
            { id: "slide-progress", label: "Slide Progress Tracker (workflow status)", icon: "✓", keywords: ["progress", "status", "workflow", "done", "todo", "in progress", "track"], run: () => setSlideProgressOpen(true) },
            { id: "highlight-reel", label: "Highlight Reel (AI best slides)", icon: "⭐", keywords: ["highlight", "best", "top", "featured", "key slides", "most important", "ai"], run: () => setHighlightReelOpen(true) },
            { id: "font-audit", label: "Font Audit (fonts used in deck)", icon: "Tf", keywords: ["font", "typeface", "audit", "typography", "inconsistent", "fonts used"], run: () => setFontAuditOpen(true) },
            { id: "executive-briefing", label: "Executive Briefing (AI one-page summary)", icon: "✦", keywords: ["executive", "briefing", "summary", "one-page", "memo", "download", "ai", "overview"], run: () => setExecBriefingOpen(true) },
            { id: "margin-check", label: "Margin Check (elements too close to edges)", icon: "⊡", keywords: ["margin", "bleed", "edge", "safe zone", "overflow", "alignment", "check"], run: () => setMarginCheckOpen(true) },
            { id: "clone-slide-to", label: "Clone Current Slide to Position…", icon: "⧉", keywords: ["clone", "copy", "duplicate", "slide", "insert", "position", "reorder"], run: async () => { const pos = parseInt(prompt(`Clone slide ${selectedSlide} to position (1–${localSlideCount + 1}):`) ?? "", 10); if (!isNaN(pos) && pos >= 1) { try { const r = await cloneSlideTo(doc.doc_id, selectedSlide, pos); handleSlideCountChange(r.slide_count, r.new_slide_n); setRefreshKey((k) => k + 1) } catch (e) { console.error("clone-to failed:", e) } } } },
            { id: "deck-tagline", label: "Deck Tagline Generator (AI one-liner)", icon: "✦", keywords: ["tagline", "one-liner", "slogan", "summary", "ai", "hook", "pitch"], run: () => setDeckTaglineOpen(true) },
            { id: "section-word-count", label: "Section Word Count (distribution by section)", icon: "≡", keywords: ["word count", "section", "words", "distribution", "analysis", "stats"], run: () => setSectionWordCountOpen(true) },
            { id: "complexity-heatmap", label: "Complexity Heatmap (slide visual weight)", icon: "▦", keywords: ["complexity", "heatmap", "visual", "weight", "density", "light", "heavy"], run: () => setComplexityHeatmapOpen(true) },
            { id: "reorder-rationale", label: "Slide Order Rationale (AI flow analysis)", icon: "✦", keywords: ["reorder", "order", "flow", "rationale", "narrative", "sequence", "ai", "analysis"], run: () => setReorderRationaleOpen(true) },
            { id: "duplicate-deck", label: "Duplicate Entire Deck (new document)", icon: "⧉", keywords: ["duplicate", "copy", "clone", "deck", "document", "new", "backup"], run: async () => { const name = prompt("New deck name (leave blank to auto-name):") ?? ""; try { const r = await duplicateDeck(doc.doc_id, name); alert(`Deck duplicated! New doc ID: ${r.new_doc_id}\n"${r.name}" — ${r.slide_count} slides`) } catch (e) { console.error("duplicate-deck failed:", e) } } },
            { id: "reading-order", label: "Reading Order Check (element sequence)", icon: "↓", keywords: ["reading order", "order", "sequence", "tab order", "accessibility", "elements"], run: () => setReadingOrderOpen(true) },
            { id: "title-critique", label: "Title Slide Critique (AI review)", icon: "✦", keywords: ["title slide", "critique", "ai", "review", "opening", "first slide", "feedback"], run: () => setTitleCritiqueOpen(true) },
            { id: "clutter-score", label: "Clutter Score (visual crowding analysis)", icon: "▦", keywords: ["clutter", "crowded", "overlap", "density", "elements", "clean", "tidy"], run: () => setClutterScoreOpen(true) },
            { id: "cta-slide", label: "AI Call-to-Action Slide (closing slide)", icon: "✦", keywords: ["cta", "call to action", "closing", "action", "next steps", "ai", "generate"], run: () => setCtaSlideOpen(true) },
            { id: "bulk-font-replace", label: "Bulk Font Replace (swap font across deck)", icon: "Tf", keywords: ["font", "replace", "swap", "bulk", "typeface", "rename", "consistency"], run: async () => { const from = prompt("Font to replace:"); if (!from) return; const to = prompt(`Replace "${from}" with:`); if (!to) return; try { const r = await bulkFontReplace(doc.doc_id, from, to); if (r.replaced > 0) { r.affected_slides.forEach((n) => markDirty(n)); setRefreshKey((k) => k + 1); alert(`Replaced "${r.from_font}" with "${r.to_font}" in ${r.replaced} run${r.replaced !== 1 ? "s" : ""} across ${r.affected_slides.length} slide${r.affected_slides.length !== 1 ? "s" : ""}`) } else { alert(`Font "${from}" not found in any text runs.`) } } catch (e) { console.error("bulk-font-replace failed:", e) } } },
            { id: "opening-hook", label: "Opening Hook Rewriter (AI title slide hook)", icon: "✦", keywords: ["opening", "hook", "title", "rewrite", "ai", "attention", "grabbing", "first slide"], run: () => setOpeningHookOpen(true) },
            { id: "toc-check", label: "Table of Contents Check (verify TOC accuracy)", icon: "≡", keywords: ["toc", "table of contents", "agenda", "check", "verify", "consistency", "titles"], run: () => setTocCheckOpen(true) },
            { id: "link-checker", label: "Link Checker (scan all URLs in deck)", icon: "⌁", keywords: ["link", "url", "hyperlink", "check", "scan", "http", "https", "broken"], run: () => setLinkCheckerOpen(true) },
            { id: "metaphor-finder", label: "Metaphor Finder (AI storytelling suggestions)", icon: "✦", keywords: ["metaphor", "analogy", "storytelling", "ai", "message", "strengthen", "clarity"], run: () => setMetaphorOpen(true) },
            { id: "speaker-confidence", label: "Speaker Confidence Score (assertiveness check)", icon: "✦", keywords: ["speaker", "confidence", "notes", "assertive", "hedging", "ai", "score"], run: () => setSpeakerConfidenceOpen(true) },
            { id: "style-guide", label: "Deck Style Guide (extracted fonts & colors)", icon: "◉", keywords: ["style guide", "fonts", "colors", "design", "branding", "extract", "palette", "type scale"], run: () => setStyleGuideOpen(true) },
            { id: "agenda-sync", label: "Agenda Sync (AI updates TOC to match sections)", icon: "✦", keywords: ["agenda", "sync", "toc", "table of contents", "update", "sections", "ai"], run: () => setAgendaSyncOpen(true) },
            { id: "pace-checker", label: "Pace Checker (slides over word limit)", icon: "⏱", keywords: ["pace", "word count", "limit", "dense", "wordy", "too many words", "pacing"], run: () => setPaceCheckerOpen(true) },
            { id: "counter-arguments", label: "Counterargument Prep (AI Q&A preparation)", icon: "✦", keywords: ["counterargument", "objection", "qa", "q&a", "tough questions", "ai", "debate"], run: () => setCounterArgsOpen(true) },
            { id: "humor-suggestions", label: "Humor Suggestions (AI engagement boost)", icon: "✦", keywords: ["humor", "funny", "joke", "anecdote", "engage", "lighten", "ai"], run: () => setHumorOpen(true) },
            { id: "data-table-detector", label: "Data Table Detector (text that should be tables)", icon: "⊞", keywords: ["table", "data", "tabular", "csv", "columns", "rows", "spreadsheet"], run: () => setDataTableOpen(true) },
            { id: "alignment-audit", label: "Text Alignment Audit (inconsistent alignment)", icon: "≡", keywords: ["alignment", "text align", "inconsistent", "left", "center", "right", "audit"], run: () => setAlignmentAuditOpen(true) },
            { id: "notes-length", label: "Notes Length Check (overly long speaker notes)", icon: "≡", keywords: ["notes", "speaker notes", "length", "long", "wordy", "check"], run: () => setNotesLengthOpen(true) },
            { id: "deck-quiz", label: "Deck Quiz (AI comprehension questions)", icon: "✦", keywords: ["quiz", "test", "comprehension", "questions", "ai", "multiple choice", "education"], run: () => setDeckQuizOpen(true) },
            { id: "background-audit", label: "Background Color Audit (inconsistent slides)", icon: "◉", keywords: ["background", "color", "audit", "inconsistent", "branding", "slides"], run: () => setBackgroundAuditOpen(true) },
            { id: "placeholder-finder", label: "Placeholder Finder (TODO, TBD, [placeholder])", icon: "⚠", keywords: ["placeholder", "todo", "tbd", "fixme", "incomplete", "missing", "fill in"], run: () => setPlaceholderOpen(true) },
            { id: "action-plan", label: "Action Plan Extractor (AI pull action items)", icon: "✦", keywords: ["action", "plan", "todo", "owner", "deadline", "next steps", "ai", "extract"], run: () => setActionPlanOpen(true) },
            { id: "section-titles", label: "Section Title Optimizer (AI improve titles)", icon: "✦", keywords: ["title", "section", "heading", "improve", "ai", "optimize", "slide title"], run: () => setSectionTitleOpen(true) },
            { id: "bookmarks", label: "Bookmark Manager (save important slides)", icon: "🔖", keywords: ["bookmark", "save", "pin", "favorite", "quick access", "navigate"], run: () => setBookmarkOpen(true) },
            { id: "data-insights", label: "Data Insights (AI extract statistics)", icon: "✦", keywords: ["data", "statistics", "numbers", "insights", "ai", "extract", "metrics", "claims"], run: () => setDataInsightsOpen(true) },
            { id: "narrative-arc", label: "Narrative Arc Analysis (AI story check)", icon: "✦", keywords: ["narrative", "story", "arc", "flow", "structure", "ai", "problem solution", "journey"], run: () => setNarrativeArcOpen(true) },
            { id: "grid-check", label: "Grid Check (element alignment snap)", icon: "⊞", keywords: ["grid", "snap", "alignment", "consistent", "position", "layout", "precision"], run: () => setGridCheckOpen(true) },
            { id: "persuasion-score", label: "Persuasion Score (AI rate each slide)", icon: "✦", keywords: ["persuasion", "score", "rating", "compelling", "ai", "evaluate", "impact"], run: () => setPersuasionScoreOpen(true) },
            { id: "social-snippets", label: "Social Snippets (generate shareable posts)", icon: "✦", keywords: ["social", "linkedin", "twitter", "post", "share", "snippets", "caption", "ai"], run: () => setSocialSnippetsOpen(true) },
            { id: "text-overflow", label: "Text Overflow Check (find clipped content)", icon: "⚠", keywords: ["text", "overflow", "clipped", "cut off", "hidden", "box", "too long", "check"], run: () => setTextOverflowOpen(true) },
            { id: "audience-questions", label: "Audience Questions (predict Q&A for slide)", icon: "✦", keywords: ["audience", "questions", "qa", "q&a", "predict", "anticipate", "ai", "current slide"], run: () => setAudienceQuestionsOpen(true) },
            { id: "tone-consistency", label: "Tone Consistency Check (AI uniform voice)", icon: "✦", keywords: ["tone", "voice", "consistent", "formal", "casual", "writing", "style", "ai"], run: () => setToneConsistencyOpen(true) },
            { id: "sentence-variety", label: "Sentence Variety Check (long/short sentences)", icon: "≡", keywords: ["sentence", "variety", "long", "short", "words", "writing", "check"], run: () => setSentenceVarietyOpen(true) },
            { id: "export-checklist", label: "Export Checklist (pre-flight before sharing)", icon: "✓", keywords: ["export", "checklist", "preflight", "ready", "share", "missing", "issues", "check"], run: () => setExportChecklistOpen(true) },
            { id: "image-descriptions", label: "Image Descriptions (AI alt text for images)", icon: "✦", keywords: ["image", "alt text", "description", "accessibility", "ai", "picture", "photo"], run: () => setImageDescOpen(true) },
            { id: "redundancy-finder", label: "Redundancy Finder (repeated phrases across slides)", icon: "⊘", keywords: ["redundant", "repeated", "duplicate", "phrase", "same", "copy", "reuse"], run: () => setRedundancyOpen(true) },
            { id: "passive-voice", label: "Passive Voice Detector (weak language)", icon: "⚑", keywords: ["passive", "voice", "weak", "was written", "is done", "writing", "grammar"], run: () => setPassiveVoiceOpen(true) },
            { id: "emotional-keywords", label: "Emotional Keywords (urgency, trust, fear…)", icon: "❋", keywords: ["emotional", "keywords", "urgency", "trust", "fear", "excitement", "language", "tone"], run: () => setEmotionalKwOpen(true) },
            { id: "deck-compare", label: "Deck Comparison (compare two decks)", icon: "⇄", keywords: ["compare", "two decks", "overlap", "similarity", "keywords", "diff", "deck b"], run: () => setDeckCompareOpen(true) },
            { id: "jargon-detector", label: "Jargon Detector (corporate buzzwords)", icon: "⊘", keywords: ["jargon", "buzzwords", "corporate", "synergy", "leverage", "overused", "cliché"], run: () => setJargonOpen(true) },
            { id: "story-arc", label: "Story Arc (AI narrative stage mapping)", icon: "✦", keywords: ["story", "arc", "narrative", "hook", "problem", "solution", "cta", "stage", "ai"], run: () => setStoryArcOpen(true) },
            { id: "filler-words", label: "Filler Word Counter (weak language)", icon: "✗", keywords: ["filler", "words", "weak", "basically", "just", "really", "obviously", "clutter"], run: () => setFillerWordsOpen(true) },
            { id: "acronym-explainer", label: "Acronym Explainer (AI define abbreviations)", icon: "✦", keywords: ["acronym", "abbreviation", "definition", "explain", "ai", "cta", "kpi", "roi"], run: () => setAcronymOpen(true) },
            { id: "weak-verbs", label: "Weak Verb Highlighter (is, are, was…)", icon: "⚑", keywords: ["weak", "verb", "is", "are", "was", "linking", "passive", "writing"], run: () => setWeakVerbsOpen(true) },
            { id: "bullet-analysis", label: "Bullet Analysis (depth, length, structure)", icon: "≡", keywords: ["bullet", "list", "depth", "length", "nested", "structure", "analyze"], run: () => setBulletAnalysisOpen(true) },
            { id: "timer-estimate", label: "Timer Estimate (per-slide speaking time)", icon: "⏱", keywords: ["timer", "time", "estimate", "speaking", "duration", "wpm", "minutes", "seconds"], run: () => setTimerEstimateOpen(true) },
            { id: "color-report", label: "Color Report (all colors in the deck)", icon: "◉", keywords: ["color", "colours", "palette", "hex", "report", "usage", "branding"], run: () => setColorReportOpen(true) },
            { id: "whitespace-analysis", label: "Whitespace Analysis (crowded vs. sparse slides)", icon: "□", keywords: ["whitespace", "empty", "crowded", "sparse", "breathing room", "space", "layout"], run: () => setWhitespaceOpen(true) },
            { id: "font-pairing", label: "Font Pairing Suggestions (AI heading + body)", icon: "✦", keywords: ["font", "pairing", "heading", "body", "typography", "suggest", "ai", "harmonious"], run: () => setFontPairingOpen(true) },
            { id: "section-summary", label: "Section Summary (AI summarize slides)", icon: "✦", keywords: ["summary", "section", "summarize", "overview", "ai", "slides", "executive", "brief"], run: () => setSectionSummaryOpen(true) },
            { id: "first-impression", label: "First Impression Score (AI rate opening slide)", icon: "✦", keywords: ["first", "impression", "opening", "slide", "score", "ai", "critique", "hook"], run: () => setFirstImpressionOpen(true) },
            { id: "cta-strength", label: "CTA Strength Analyzer (call-to-action rating)", icon: "✦", keywords: ["cta", "call to action", "strength", "compelling", "closing", "ai", "rate"], run: () => setCtaStrengthOpen(true) },
            { id: "keyword-density", label: "Keyword Density Map (word frequency)", icon: "≡", keywords: ["keyword", "density", "frequency", "word count", "map", "top words", "usage"], run: () => setKeywordDensityOpen(true) },
            { id: "repetition-heatmap", label: "Repetition Heatmap (per-slide word reuse)", icon: "▦", keywords: ["repetition", "heatmap", "repeated", "word reuse", "per slide", "redundancy", "score"], run: () => setRepetitionHeatmapOpen(true) },
            { id: "claim-checker", label: "Claim Checker (AI flag unsubstantiated assertions)", icon: "✦", keywords: ["claim", "assertion", "citation", "source", "evidence", "fact", "ai", "verify"], run: () => setClaimCheckerOpen(true) },
            { id: "discussion-questions", label: "Discussion Questions (AI open-ended prompts)", icon: "✦", keywords: ["discussion", "questions", "group", "workshop", "open ended", "ai", "debate"], run: () => setDiscussionQxOpen(true) },
            { id: "vocabulary-level", label: "Vocabulary Level (Flesch-Kincaid grade)", icon: "Aa", keywords: ["vocabulary", "reading level", "grade", "flesch", "complexity", "words", "syllables"], run: () => setVocabularyOpen(true) },
            { id: "completeness-report", label: "Completeness Report (production-readiness score)", icon: "✓", keywords: ["complete", "readiness", "production", "score", "check", "dimensions", "report"], run: () => setCompletenessOpen(true) },
            { id: "visual-hierarchy", label: "Visual Hierarchy Check (heading vs. body structure)", icon: "▤", keywords: ["visual", "hierarchy", "heading", "body", "indent", "structure", "level", "nesting"], run: () => setVisualHierarchyOpen(true) },
            { id: "sentiment-arc", label: "Sentiment Arc (emotional tone per slide)", icon: "✦", keywords: ["sentiment", "arc", "tone", "emotion", "positive", "negative", "ai", "feeling"], run: () => setSentimentArcOpen(true) },
            { id: "tagline-variations", label: "Tagline Variations (AI 6 title/tone options)", icon: "✦", keywords: ["tagline", "title", "variations", "tone", "professional", "inspirational", "ai", "name"], run: () => setTaglineVarsOpen(true) },
            { id: "slide-length-check", label: "Slide Length Check (find outlier slides)", icon: "≡", keywords: ["slide", "length", "long", "short", "outlier", "words", "balance", "normalize"], run: () => setSlideLengthOpen(true) },
            { id: "transition-pacing", label: "Transition Pacing (detect abrupt topic shifts)", icon: "→", keywords: ["transition", "pacing", "flow", "abrupt", "shift", "continuity", "jaccard", "topic"], run: () => setTransitionPacingOpen(true) },
            { id: "hook-strength", label: "Hook Strength (AI rates opening slides)", icon: "✦", keywords: ["hook", "opening", "intro", "first", "impression", "ai", "score", "capture", "attention"], run: () => setHookStrengthOpen(true) },
            { id: "data-density", label: "Data Density (flag overloaded slides)", icon: "■", keywords: ["data", "density", "numbers", "bullets", "overloaded", "percentage", "heavy", "slides"], run: () => setDataDensityOpen(true) },
            { id: "closing-impact", label: "Closing Impact (AI rates final slides)", icon: "✦", keywords: ["closing", "impact", "final", "end", "conclusion", "cta", "memorability", "ai"], run: () => setClosingImpactOpen(true) },
            { id: "redundant-slides", label: "Redundant Slides (find overlapping content)", icon: "≈", keywords: ["redundant", "duplicate", "overlap", "similar", "repeat", "slides", "content"], run: () => setRedundantSlidesOpen(true) },
            { id: "tone-shift", label: "Tone Shift Alert (AI detects tone changes)", icon: "✦", keywords: ["tone", "shift", "change", "inconsistent", "casual", "formal", "ai", "alert"], run: () => setToneShiftOpen(true) },
            { id: "persuasion-framework", label: "Persuasion Framework (Ethos/Pathos/Logos)", icon: "✦", keywords: ["persuasion", "ethos", "pathos", "logos", "rhetoric", "credibility", "emotion", "logic"], run: () => setPersuasionFwOpen(true) },
            { id: "confidence-scores", label: "Slide Confidence Scores (structure quality)", icon: "◆", keywords: ["confidence", "score", "quality", "structure", "grade", "title", "depth", "slides"], run: () => setConfidenceScoresOpen(true) },
            { id: "complexity-index", label: "Complexity Index (composite slide complexity)", icon: "■", keywords: ["complexity", "index", "composite", "score", "fonts", "shapes", "nesting", "slide"], run: () => setComplexityIndexOpen(true) },
            { id: "quote-extractor", label: "Quote Extractor (find quoted text)", icon: "\"", keywords: ["quote", "extractor", "quotation", "cited", "attributed", "source", "text"], run: () => setQuoteExtractorOpen(true) },
            { id: "presentation-risks", label: "Presentation Risks (AI red flags)", icon: "✦", keywords: ["risk", "red flag", "issue", "problem", "claim", "legal", "offensive", "ai"], run: () => setPresentationRisksOpen(true) },
            { id: "audience-fit", label: "Audience Fit Score (AI rates deck fit)", icon: "✦", keywords: ["audience", "fit", "score", "target", "investors", "executives", "technical", "ai"], run: () => setAudienceFitOpen(true) },
            { id: "analogy-finder", label: "Analogy Finder (locate similes in deck)", icon: "~", keywords: ["analogy", "simile", "like", "similar", "metaphor", "comparison", "find"], run: () => setAnalogyFinderOpen(true) },
            { id: "action-verbs", label: "Action Verbs Audit (strong vs weak language)", icon: "V", keywords: ["action", "verbs", "strong", "weak", "language", "nominal", "audit", "drive"], run: () => setActionVerbsOpen(true) },
            { id: "emotional-payoff", label: "Emotional Payoff (AI rates impact moments)", icon: "✦", keywords: ["emotional", "payoff", "impact", "moment", "inspiration", "urgency", "ai", "feeling"], run: () => setEmotionalPayoffOpen(true) },
            { id: "clarity-score", label: "Clarity Score (sentence clarity and jargon)", icon: "◎", keywords: ["clarity", "score", "clear", "jargon", "sentence", "length", "readable"], run: () => setClarityScoreOpen(true) },
            { id: "buzzword-density", label: "Buzzword Density (corporate jargon flags)", icon: "⚡", keywords: ["buzzword", "density", "jargon", "corporate", "synergy", "disruptive", "cliché"], run: () => setBuzzwordDensityOpen(true) },
            { id: "slide-intent", label: "Slide Intent Map (AI assigns intent per slide)", icon: "✦", keywords: ["intent", "purpose", "map", "inform", "persuade", "inspire", "ai", "communicate"], run: () => setSlideIntentOpen(true) },
            { id: "narrative-gaps", label: "Narrative Gaps (AI finds missing story pieces)", icon: "✦", keywords: ["narrative", "gap", "story", "missing", "transition", "thread", "flow", "ai"], run: () => setNarrativeGapsOpen(true) },
            { id: "evidence-audit", label: "Evidence Audit (unsupported claims)", icon: "⚠", keywords: ["evidence", "audit", "claim", "unsupported", "data", "citation", "source", "proof"], run: () => setEvidenceAuditOpen(true) },
            { id: "competitive-language", label: "Competitive Language (superlatives and comparisons)", icon: "⚔", keywords: ["competitive", "comparison", "superlative", "better than", "leader", "unique", "competitor"], run: () => setCompetitiveLangOpen(true) },
            { id: "metaphor-density", label: "Metaphor Density (AI finds figurative language)", icon: "✦", keywords: ["metaphor", "simile", "figurative", "language", "hyperbole", "personification", "ai"], run: () => setMetaphorDensityOpen(true) },
            { id: "impact-ranking", label: "Slide Impact Ranking (AI ranks by audience impact)", icon: "✦", keywords: ["impact", "rank", "ranking", "audience", "memorable", "score", "ai", "best slides"], run: () => setImpactRankingOpen(true) },
            { id: "content-balance", label: "Content Balance (text vs visual ratio)", icon: "◑", keywords: ["content", "balance", "text", "visual", "image", "ratio", "heavy", "chart"], run: () => setContentBalanceOpen(true) },
            { id: "speaker-density", label: "Speaker Density (slide vs notes balance)", icon: "◑", keywords: ["speaker", "density", "notes", "slide", "ratio", "heavy", "balanced"], run: () => setSpeakerDensityOpen(true) },
            { id: "acronym-map", label: "Acronym Map (all acronyms and locations)", icon: "A", keywords: ["acronym", "abbreviation", "map", "uppercase", "location", "capital", "letters"], run: () => setAcronymMapOpen(true) },
            { id: "promise-tracker", label: "Promise Tracker (future commitments)", icon: "📋", keywords: ["promise", "commitment", "will", "guarantee", "ensure", "deliver", "future"], run: () => setPromiseTrackerOpen(true) },
            { id: "slide-repetition", label: "Slide Repetition Score (repeated vocabulary)", icon: "↺", keywords: ["repetition", "repeat", "vocabulary", "score", "common", "words", "frequency"], run: () => setSlideRepetitionOpen(true) },
            { id: "numeric-consistency", label: "Numeric Consistency (numbers across slides)", icon: "#", keywords: ["number", "numeric", "consistent", "data", "figure", "repeat", "value"], run: () => setNumericConsistOpen(true) },
            { id: "title-uniqueness", label: "Title Uniqueness (duplicate slide titles)", icon: "T", keywords: ["title", "unique", "duplicate", "heading", "slide", "repeat", "same"], run: () => setTitleUniquenessOpen(true) },
            { id: "deck-punchline", label: "Deck Punchline (AI core message)", icon: "✦", keywords: ["punchline", "core", "message", "summary", "sentence", "distill", "ai", "takeaway"], run: () => setDeckPunchlineOpen(true) },
            { id: "opening-stats", label: "Opening Statistics (numbers in first slides)", icon: "%", keywords: ["opening", "stats", "statistics", "numbers", "hook", "first", "slides"], run: () => setOpeningStatsOpen(true) },
            { id: "urgency-detector", label: "Urgency Detector (FOMO, deadlines, pressure)", icon: "⏰", keywords: ["urgency", "FOMO", "deadline", "pressure", "scarcity", "time", "limited"], run: () => setUrgencyDetectorOpen(true) },
            { id: "question-count", label: "Question Count (rhetorical questions)", icon: "?", keywords: ["question", "count", "rhetorical", "interrogative", "ask", "slides"], run: () => setQuestionCountOpen(true) },
            { id: "value-proposition", label: "Value Proposition Finder (AI benefit statements)", icon: "✦", keywords: ["value", "proposition", "benefit", "statement", "customer", "offer", "ai"], run: () => setValuePropOpen(true) },
            { id: "topic-coverage", label: "Topic Coverage Map (covered/over/missing)", icon: "✦", keywords: ["topic", "coverage", "map", "missing", "over-covered", "subjects", "ai"], run: () => setTopicCoverageOpen(true) },
            { id: "density-heatmap", label: "Density Heatmap (words/shapes/images per slide)", icon: "▓", keywords: ["density", "heatmap", "words", "shapes", "images", "bullets", "load", "content"], run: () => setDensityHeatmapOpen(true) },
            { id: "presentation-dna", label: "Presentation DNA (style, personality, archetype)", icon: "✦", keywords: ["dna", "style", "personality", "archetype", "signature", "strengths", "blind spots", "ai"], run: () => setPresentationDNAOpen(true) },
            { id: "speaker-tips", label: "Speaker Tips (AI delivery coaching per slide)", icon: "✦", keywords: ["speaker", "tips", "coaching", "delivery", "technique", "presenting", "ai"], run: () => setSpeakerTipsOpen(true) },
            { id: "objection-handler", label: "Objection Handler (anticipate audience objections)", icon: "✦", keywords: ["objection", "rebuttal", "audience", "pushback", "counter", "tough", "ai"], run: () => setObjectionHandlerOpen(true) },
            { id: "slide-questions", label: "Slide Discussion Questions (per-slide comprehension)", icon: "?", keywords: ["questions", "discussion", "comprehension", "slide", "quiz", "learning"], run: () => setSlideQuestionsOpen(true) },
            { id: "deck-manifesto", label: "Deck Manifesto (AI bold declarations from your deck)", icon: "✦", keywords: ["manifesto", "declaration", "philosophy", "bold", "principles", "ai"], run: () => setDeckManifestoOpen(true) },
            { id: "bullet-brevity", label: "Bullet Brevity (flag overly long bullets)", icon: "▶", keywords: ["bullet", "brevity", "long", "word count", "trim", "concise", "length"], run: () => setBulletBrevityOpen(true) },
            { id: "insight-extractor", label: "Insight Extractor (AI quotable moments)", icon: "✦", keywords: ["insight", "quote", "takeaway", "memorable", "stat", "claim", "ai"], run: () => setInsightExtractorOpen(true) },
            { id: "slide-transitions-info", label: "Slide Transition Audit (which slides have transitions)", icon: "▷", keywords: ["transition", "animation", "audit", "slides", "effects"], run: () => setSlideTransInfoOpen(true) },
            { id: "story-gap-filler", label: "Story Gap Filler (AI bridging content suggestions)", icon: "✦", keywords: ["story", "gap", "narrative", "bridge", "flow", "missing", "ai"], run: () => setStoryGapFillerOpen(true) },
            { id: "image-text-ratio", label: "Image-Text Ratio (visual vs text balance per slide)", icon: "⊙", keywords: ["image", "text", "ratio", "balance", "visual", "layout", "heavy"], run: () => setImageTextRatioOpen(true) },
            { id: "metaphor-suggester", label: "Metaphor Suggester (AI analogies for abstract ideas)", icon: "✦", keywords: ["metaphor", "analogy", "abstract", "comparison", "storytelling", "ai"], run: () => setMetaphorSuggesterOpen(true) },
            { id: "emoji-usage", label: "Emoji Usage (map emoji across slides)", icon: "😊", keywords: ["emoji", "emoticon", "symbols", "icons", "usage", "scan"], run: () => setEmojiUsageOpen(true) },
            { id: "slide-mood-board", label: "Slide Mood Board (AI visual direction per slide)", icon: "✦", keywords: ["mood", "board", "visual", "aesthetic", "palette", "imagery", "feel", "ai"], run: () => setSlideMoodBoardOpen(true) },
            { id: "long-sentences", label: "Long Sentence Detector (flag overly long sentences)", icon: "—", keywords: ["sentence", "long", "word count", "flag", "length", "verbose"], run: () => setLongSentencesOpen(true) },
            { id: "elevator-pitch", label: "Deck Elevator Pitch (AI 30-second pitch, 3 styles)", icon: "✦", keywords: ["elevator", "pitch", "30 second", "summary", "formal", "casual", "bold", "ai"], run: () => setElevatorPitchOpen(true) },
            { id: "header-footer-check", label: "Header/Footer Check (recurring text across slides)", icon: "≡", keywords: ["header", "footer", "recurring", "repeat", "banner", "consistent"], run: () => setHeaderFooterOpen(true) },
            { id: "section-intros", label: "Section Intros (AI engaging intro per section)", icon: "✦", keywords: ["section", "intro", "introduction", "transition", "opening", "ai"], run: () => setSectionIntrosOpen(true) },
            { id: "text-alignment-audit", label: "Text Alignment Audit (left/center/right mapping)", icon: "≡", keywords: ["alignment", "text", "left", "center", "right", "justify", "paragraph"], run: () => setTextAlignAuditOpen(true) },
            { id: "reframe-suggestions", label: "Reframe Suggestions (AI positive rewriting)", icon: "✦", keywords: ["reframe", "positive", "weak", "negative", "improve", "confident", "rewrite", "ai"], run: () => setReframeSuggestOpen(true) },
            { id: "passive-constructions", label: "Passive Voice Detector (flag passive constructions)", icon: "~", keywords: ["passive", "voice", "was", "were", "constructions", "weak", "active"], run: () => setPassiveConstructOpen(true) },
            { id: "slide-taglines", label: "Slide Taglines (AI one-liner per slide)", icon: "✦", keywords: ["tagline", "one-liner", "slogan", "slide", "memorable", "punchy", "ai"], run: () => setSlideTaglinesOpen(true) },
            { id: "punctuation-audit", label: "Punctuation Audit (terminal period consistency)", icon: ".", keywords: ["punctuation", "period", "consistency", "terminal", "bullet", "style"], run: () => setPunctuationAuditOpen(true) },
            { id: "authority-signals", label: "Authority Signals (AI credibility indicators)", icon: "✦", keywords: ["authority", "credibility", "stat", "testimonial", "award", "credential", "ai"], run: () => setAuthoritySignalsOpen(true) },
            { id: "shape-inventory", label: "Shape Inventory (count & categorize all shapes)", icon: "◻", keywords: ["shape", "inventory", "count", "categorize", "picture", "chart", "table", "text"], run: () => setShapeInventoryOpen(true) },
            { id: "assumption-checker", label: "Assumption Checker (AI finds unstated assumptions)", icon: "✦", keywords: ["assumption", "unstated", "knowledge", "risk", "audience", "jargon", "ai"], run: () => setAssumptionCheckerOpen(true) },
            { id: "font-size-distribution", label: "Font Size Distribution (histogram of all font sizes)", icon: "A", keywords: ["font", "size", "distribution", "histogram", "pt", "typography", "points"], run: () => setFontSizeDistOpen(true) },
            { id: "key-message-extractor", label: "Key Message Extractor (AI top 3 messages)", icon: "✦", keywords: ["key", "message", "extract", "top", "important", "core", "takeaway", "ai"], run: () => setKeyMessageOpen(true) },
            { id: "text-color-audit", label: "Text Color Audit (distinct colors per slide)", icon: "●", keywords: ["text", "color", "colour", "audit", "rgb", "hex", "palette"], run: () => setTextColorAuditOpen(true) },
            { id: "competitive-positioning", label: "Competitive Positioning (AI vs. competitors analysis)", icon: "✦", keywords: ["competitive", "positioning", "competitor", "differentiate", "advantage", "market", "ai"], run: () => setCompetitivePosOpen(true) },
            { id: "empty-notes-finder", label: "Empty Notes Finder (slides without speaker notes)", icon: "○", keywords: ["empty", "notes", "speaker", "missing", "blank", "coverage"], run: () => setEmptyNotesOpen(true) },
            { id: "deck-quiz-generator", label: "Deck Quiz Generator (AI 5-question comprehension quiz)", icon: "✦", keywords: ["quiz", "question", "comprehension", "test", "multiple choice", "learn", "ai"], run: () => setDeckQuizGenOpen(true) },
            { id: "slide-symmetry", label: "Slide Symmetry (left/right content balance per slide)", icon: "⊜", keywords: ["symmetry", "balance", "left", "right", "layout", "visual", "center"], run: () => setSlideSymmetryOpen(true) },
            { id: "objection-map", label: "Objection Map (AI theme-clustered objections)", icon: "✦", keywords: ["objection", "map", "theme", "cluster", "group", "audience", "ai"], run: () => setObjectionMapOpen(true) },
            { id: "text-density-per-word", label: "Text Density Per Shape (avg words per text box)", icon: "≡", keywords: ["text", "density", "words", "shape", "average", "per shape", "heavy"], run: () => setTextDensityWordOpen(true) },
            { id: "story-beats", label: "Slide Story Beats (AI narrative role per slide)", icon: "✦", keywords: ["story", "beat", "narrative", "setup", "conflict", "resolution", "arc", "ai"], run: () => setStoryBeatsOpen(true) },
            { id: "placeholder-finder", label: "Placeholder Text Finder (lorem ipsum, TBD)", icon: "⚠", keywords: ["placeholder", "lorem", "ipsum", "tbd", "template", "unfilled", "empty"], run: () => setPlaceholderFinderOpen(true) },
            { id: "audience-journey", label: "Audience Journey Map (AI emotional flow)", icon: "✦", keywords: ["audience", "journey", "emotion", "feel", "flow", "engagement", "ai"], run: () => setAudienceJourneyOpen(true) },
            { id: "link-density", label: "Link Density (hyperlinks per slide)", icon: "⎔", keywords: ["link", "hyperlink", "url", "density", "count", "href"], run: () => setLinkDensityOpen(true) },
            { id: "summary-bullets", label: "Executive Summary (AI 5-bullet deck overview)", icon: "✦", keywords: ["summary", "executive", "bullets", "overview", "tldr", "brief", "ai"], run: () => setSummaryBulletsOpen(true) },
            { id: "color-contrast", label: "Color Contrast Audit (flag low-contrast text)", icon: "◑", keywords: ["color", "contrast", "accessibility", "wcag", "legibility", "text", "background"], run: () => setColorContrastOpen(true) },
            { id: "deck-personality", label: "Deck Personality (AI archetype profile)", icon: "✦", keywords: ["personality", "archetype", "tone", "style", "voice", "brand", "ai"], run: () => setDeckPersonalityOpen(true) },
            { id: "title-length", label: "Title Length Audit (missing or long titles)", icon: "T", keywords: ["title", "length", "long", "missing", "characters", "heading", "slide title"], run: () => setTitleLengthOpen(true) },
            { id: "cta-finder", label: "Call-to-Action Finder (AI CTA evaluation)", icon: "✦", keywords: ["cta", "call to action", "action", "button", "click", "next step", "ai"], run: () => setCtaFinderOpen(true) },
            { id: "word-histogram", label: "Word Count Histogram (distribution by slide)", icon: "▦", keywords: ["word", "count", "histogram", "distribution", "density", "per slide"], run: () => setWordHistogramOpen(true) },
            { id: "rhetorical-finder", label: "Rhetorical Device Finder (AI anaphora, tricolon…)", icon: "✦", keywords: ["rhetoric", "anaphora", "tricolon", "antithesis", "device", "figure", "speech", "ai"], run: () => setRhetoricalOpen(true) },
            { id: "z-order-audit", label: "Shape Z-Order Audit (overlapping shapes)", icon: "⊞", keywords: ["z-order", "overlap", "layer", "shape", "clutter", "stacking"], run: () => setZOrderOpen(true) },
            { id: "comp-gap", label: "Competitive Gap Analyzer (AI vs. competitors)", icon: "✦", keywords: ["competitive", "gap", "competitor", "benchmark", "compare", "missing", "ai"], run: () => setCompGapOpen(true) },
            { id: "bullet-count", label: "Bullet Count Per Slide (flag overcrowded slides)", icon: "•", keywords: ["bullet", "count", "per slide", "overcrowded", "list", "items"], run: () => setBulletCountOpen(true) },
            { id: "hook-analyzer", label: "Slide Hook Analyzer (AI opening hook strength)", icon: "✦", keywords: ["hook", "opening", "first impression", "attention", "grab", "ai"], run: () => setHookAnalyzerOpen(true) },
            { id: "img-caption", label: "Image Caption Checker (detect uncaptioned images)", icon: "⬜", keywords: ["image", "caption", "picture", "alt text", "description", "uncaptioned"], run: () => setImgCaptionOpen(true) },
            { id: "data-story", label: "Data Story Checker (AI chart narrative quality)", icon: "✦", keywords: ["data", "story", "chart", "graph", "narrative", "numbers", "ai"], run: () => setDataStoryOpen(true) },
            { id: "pacing-score", label: "Slide Pacing Score (content density timing)", icon: "⏱", keywords: ["pacing", "timing", "duration", "fast", "slow", "speed", "minutes"], run: () => setPacingOpen(true) },
            { id: "trust-signal", label: "Trust Signal Finder (AI testimonials & certs)", icon: "✦", keywords: ["trust", "testimonial", "certification", "case study", "logo", "social proof", "ai"], run: () => setTrustSignalOpen(true) },
            { id: "repeated-words", label: "Repeated Words Audit (overused vocabulary)", icon: "∑", keywords: ["repeated", "words", "frequency", "overused", "vocabulary", "jargon"], run: () => setRepeatedWordsOpen(true) },
            { id: "transitions-advisor", label: "Slide Transitions Advisor (AI transition types)", icon: "✦", keywords: ["transition", "animation", "fade", "push", "morph", "between slides", "ai"], run: () => setTransitionsAdvisorOpen(true) },
            { id: "layout-audit", label: "Slide Layout Type Audit (classify layouts)", icon: "⊡", keywords: ["layout", "type", "template", "two column", "title", "blank", "classify"], run: () => setLayoutAuditOpen(true) },
            { id: "opening-closer", label: "Opening & Closer Evaluator (AI first/last slide)", icon: "✦", keywords: ["opening", "closing", "first slide", "last slide", "intro", "outro", "ai"], run: () => setOpeningCloserOpen(true) },
            { id: "acronym-finder", label: "Acronym Finder (unexplained abbreviations)", icon: "ABC", keywords: ["acronym", "abbreviation", "abbreviate", "unexplained", "jargon", "initialism"], run: () => setAcronymOpen(true) },
            { id: "complexity-ranker", label: "Slide Complexity Ranker (AI visual+content score)", icon: "✦", keywords: ["complexity", "rank", "simple", "complex", "cluttered", "simplify", "ai"], run: () => setComplexityRankerOpen(true) },
            { id: "numbered-list-check", label: "Numbered List Consistency (sequential check)", icon: "1.", keywords: ["numbered", "list", "sequence", "consistent", "skip", "out of order"], run: () => setNumberedListOpen(true) },
            { id: "persuasion-detector", label: "Persuasion Framework Detector (AI AIDA, PAS…)", icon: "✦", keywords: ["persuasion", "aida", "pas", "fab", "framework", "structure", "ai"], run: () => setPersuasionOpen(true) },
            { id: "bounds-check", label: "Shape Bounds Check (out-of-bounds shapes)", icon: "⊞", keywords: ["bounds", "overflow", "clipped", "shape", "boundary", "outside"], run: () => setBoundsCheckOpen(true) },
            { id: "value-prop-extractor", label: "Value Proposition Extractor (AI core message)", icon: "✦", keywords: ["value", "proposition", "extractor", "benefit", "differentiator", "target audience", "ai"], run: () => setValuePropExtractOpen(true) },
            { id: "chart-count", label: "Chart Count Per Slide (charts per slide)", icon: "⬛", keywords: ["chart", "graph", "count", "per slide", "data visualization"], run: () => setChartCountOpen(true) },
            { id: "narrative-arc", label: "Narrative Arc Scorer (AI story structure)", icon: "✦", keywords: ["narrative", "arc", "story", "structure", "flow", "setup", "conflict", "ai"], run: () => setNarrativeArcOpen(true) },
            { id: "duplicate-slides", label: "Duplicate Slide Detector (similar content)", icon: "⊟", keywords: ["duplicate", "similar", "repeat", "copy", "same content", "redundant"], run: () => setDuplicateSlideOpen(true) },
            { id: "reorder-advisor", label: "Slide Reorder Advisor (AI optimal sequence)", icon: "✦", keywords: ["reorder", "order", "sequence", "flow", "rearrange", "move slides", "ai"], run: () => setReorderAdvisorOpen(true) },
            { id: "table-count-audit", label: "Table Count Audit (tables per slide)", icon: "⊞", keywords: ["table", "count", "audit", "complex", "empty", "rows", "columns"], run: () => setTableCountOpen(true) },
            { id: "emotional-tone", label: "Emotional Tone Profiler (AI tone per slide)", icon: "✦", keywords: ["emotional", "tone", "profiler", "sentiment", "mood", "feeling", "optimistic", "urgent", "ai"], run: () => setEmotionalToneOpen(true) },
            { id: "heading-hierarchy", label: "Heading Hierarchy Check (font size consistency)", icon: "⊟", keywords: ["heading", "hierarchy", "font", "size", "consistency", "h1", "h2", "title"], run: () => setHeadingHierarchyOpen(true) },
            { id: "pitch-readiness", label: "Pitch Readiness Score (AI investor score)", icon: "✦", keywords: ["pitch", "readiness", "score", "investor", "clarity", "storytelling", "credibility", "urgency", "ai"], run: () => setPitchReadinessOpen(true) },
            { id: "font-variety", label: "Font Variety Audit (distinct fonts per slide)", icon: "⊟", keywords: ["font", "variety", "audit", "typeface", "typography", "consistency"], run: () => setFontVarietyOpen(true) },
            { id: "metaphor-finder", label: "Slide Metaphor Finder (AI analogies)", icon: "✦", keywords: ["metaphor", "simile", "analogy", "figurative", "language", "comparison", "ai"], run: () => setMetaphorOpen(true) },
            { id: "empty-slide", label: "Empty Slide Detector (no content slides)", icon: "⊟", keywords: ["empty", "blank", "no content", "sparse", "missing", "placeholder"], run: () => setEmptySlideOpen(true) },
            { id: "closing-strength", label: "Closing Strength Evaluator (AI closing score)", icon: "✦", keywords: ["closing", "strength", "last slide", "cta", "call to action", "ending", "memorable", "ai"], run: () => setClosingStrengthOpen(true) },
            { id: "title-uniqueness", label: "Slide Title Uniqueness (detect duplicate titles)", icon: "⊟", keywords: ["title", "unique", "duplicate", "repeated", "same heading"], run: () => setTitleUniquenessOpen(true) },
            { id: "opening-hook", label: "Opening Hook Rater (AI first-slide strength)", icon: "✦", keywords: ["opening", "hook", "first slide", "attention", "curiosity", "energy", "ai"], run: () => setOpeningHookOpen(true) },
            { id: "speaker-note-len", label: "Speaker Note Length Checker (too short/long)", icon: "⊟", keywords: ["speaker", "notes", "length", "short", "long", "words", "presenter"], run: () => setSpeakerNoteLenOpen(true) },
            { id: "competitor-mention", label: "Competitor Mention Finder (AI brand scan)", icon: "✦", keywords: ["competitor", "brand", "mention", "rival", "comparison", "ai"], run: () => setCompetitorMentionOpen(true) },
            { id: "slide-image-count", label: "Slide Image Count (images per slide)", icon: "⬛", keywords: ["image", "picture", "photo", "count", "per slide", "visual"], run: () => setSlideImageCountOpen(true) },
            { id: "tagline-generator", label: "Presentation Tagline Generator (AI slogan)", icon: "✦", keywords: ["tagline", "slogan", "headline", "one-liner", "message", "ai"], run: () => setTaglineGenOpen(true) },
            { id: "long-sentence", label: "Long Sentence Detector (over 30 words)", icon: "⊟", keywords: ["long", "sentence", "verbose", "wordy", "concise", "30 words"], run: () => setLongSentenceOpen(true) },
            { id: "stakeholder-concern", label: "Stakeholder Concern Mapper (AI objections)", icon: "✦", keywords: ["stakeholder", "concern", "objection", "skeptic", "risk", "audience", "ai"], run: () => setStakeholderConcernOpen(true) },
            { id: "color-palette", label: "Slide Color Palette (dominant colors)", icon: "⬛", keywords: ["color", "palette", "hex", "fill", "design", "brand colors"], run: () => setColorPaletteOpen(true) },
            { id: "content-density", label: "Content Density Scorer (AI sparse/dense rating)", icon: "✦", keywords: ["density", "content", "overcrowded", "sparse", "busy", "crowded", "ai"], run: () => setContentDensityOpen(true) },
            { id: "bullet-length", label: "Bullet Length Audit (over 15 words)", icon: "⊟", keywords: ["bullet", "length", "long", "verbose", "concise", "15 words", "audit"], run: () => setBulletLengthOpen(true) },
            { id: "gap-filler", label: "Presentation Gap Filler (AI missing slides)", icon: "✦", keywords: ["gap", "missing", "slide", "add", "strengthen", "complete", "ai"], run: () => setGapFillerOpen(true) },
            { id: "shape-count", label: "Shape Count Per Slide (shape complexity)", icon: "⬛", keywords: ["shape", "count", "complex", "objects", "per slide"], run: () => setShapeCountOpen(true) },
            { id: "title-improver", label: "Slide Title Improver (AI better titles)", icon: "✦", keywords: ["title", "improve", "rewrite", "heading", "better", "ai"], run: () => setTitleImproverOpen(true) },
            { id: "numeric-data", label: "Numeric Data Spotter (numbers and stats)", icon: "⊟", keywords: ["number", "numeric", "data", "percent", "stat", "figure", "metric"], run: () => setNumericDataOpen(true) },
            { id: "objection-handler", label: "Objection Handler Generator (AI Q&A)", icon: "✦", keywords: ["objection", "handler", "q&a", "questions", "answers", "audience", "ai"], run: () => setObjectionHandlerOpen(true) },
            { id: "text-case", label: "Text Case Audit (ALL CAPS, mixed casing)", icon: "⊟", keywords: ["text", "case", "caps", "uppercase", "lowercase", "title case", "casing"], run: () => setTextCaseOpen(true) },
            { id: "audience-persona", label: "Audience Persona Builder (AI target audience)", icon: "✦", keywords: ["audience", "persona", "target", "reader", "user", "demographic", "ai"], run: () => setAudiencePersonaOpen(true) },
            { id: "footnote-finder", label: "Slide Footnote Finder (tiny text)", icon: "⊟", keywords: ["footnote", "fine print", "small text", "disclaimer", "8pt", "tiny"], run: () => setFootnoteFinderOpen(true) },
            { id: "exec-summary", label: "Deck Executive Summary (AI C-suite brief)", icon: "✦", keywords: ["executive", "summary", "brief", "tldr", "c-suite", "overview", "ai"], run: () => setExecSummaryOpen(true) },
            { id: "hyperlink-audit", label: "Slide Hyperlink Audit (all links)", icon: "⊟", keywords: ["hyperlink", "link", "url", "href", "click", "external"], run: () => setHyperlinkAuditOpen(true) },
            { id: "persuasion-rater", label: "Persuasion Intensity Rater (AI compelling score)", icon: "✦", keywords: ["persuasion", "intensity", "compelling", "convince", "persuasive", "ai"], run: () => setPersuasionRaterOpen(true) },
            { id: "iconography-check", label: "Consistent Iconography Check (image sizes)", icon: "⬛", keywords: ["icon", "image", "size", "consistent", "uniform", "iconography"], run: () => setIconographyOpen(true) },
            { id: "one-page-summary", label: "One-Page Summary Generator (AI full brief)", icon: "✦", keywords: ["one page", "summary", "brief", "overview", "structure", "ai"], run: () => setOnePageSummaryOpen(true) },
            { id: "shape-visibility", label: "Shape Visibility Audit (off-canvas shapes)", icon: "⊟", keywords: ["shape", "hidden", "off canvas", "invisible", "outside", "clipped"], run: () => setShapeVisibilityOpen(true) },
            { id: "icebreaker", label: "Icebreaker Slide Generator (AI opening activity)", icon: "✦", keywords: ["icebreaker", "opening", "activity", "engage", "warm up", "audience", "ai"], run: () => setIcebreakerOpen(true) },
            { id: "bg-color", label: "Slide Background Color Checker (background hex)", icon: "⬛", keywords: ["background", "color", "hex", "fill", "slide bg", "theme"], run: () => setBgColorOpen(true) },
            { id: "narrative-consist", label: "Narrative Consistency Checker (AI story check)", icon: "✦", keywords: ["narrative", "consistency", "tone shift", "contradiction", "drift", "ai"], run: () => setNarrativeConsistOpen(true) },
            { id: "layer-order", label: "Slide Layer Order Audit (z-order of shapes)", icon: "⊟", keywords: ["layer", "z-order", "z order", "shape order", "overlap", "stack"], run: () => setLayerOrderOpen(true) },
            { id: "brand-voice", label: "Brand Voice Scorer (AI confidence & clarity)", icon: "✦", keywords: ["brand", "voice", "tone", "confidence", "clarity", "distinctiveness", "ai"], run: () => setBrandVoiceOpen(true) },
            { id: "punct-consist", label: "Punctuation Consistency Check (period vs no punct)", icon: "·", keywords: ["punctuation", "period", "bullet", "consistency", "mixed", "endings"], run: () => setPunctConsistOpen(true) },
            { id: "split-recommend", label: "Slide Split Recommender (AI dense slide finder)", icon: "✦", keywords: ["split", "dense", "overcrowded", "divide", "two slides", "ai"], run: () => setSplitRecommendOpen(true) },
            { id: "text-density", label: "Slide Text Density (word count per slide)", icon: "⊟", keywords: ["word count", "text density", "words", "chars", "bullets", "density"], run: () => setTextDensityOpen(true) },
            { id: "transition-suggest", label: "Slide Transition Suggester (AI flow styles)", icon: "✦", keywords: ["transition", "animation", "flow", "slide style", "between slides", "ai"], run: () => setTransitionOpen(true) },
            { id: "dup-slide-content", label: "Duplicate Slide Content (similar text detector)", icon: "⊟", keywords: ["duplicate", "similar", "repeated", "same content", "overlap", "copy"], run: () => setDupSlideOpen(true) },
            { id: "cta-rater", label: "CTA Strength Rater (AI call-to-action score)", icon: "✦", keywords: ["cta", "call to action", "closing", "action", "urgency", "specificity", "ai"], run: () => setCtaRaterOpen(true) },
            { id: "agenda-detector", label: "Agenda Slide Detector (find TOC slides)", icon: "⊟", keywords: ["agenda", "table of contents", "toc", "outline", "overview", "topics"], run: () => setAgendaDetectorOpen(true) },
            { id: "passive-voice", label: "Passive Voice Detector (flag passive constructions)", icon: "⊟", keywords: ["passive", "voice", "was done", "were made", "grammar", "active voice"], run: () => setPassiveVoiceOpen(true) },
            { id: "slide-length", label: "Slide Length Estimator (speaking time per slide)", icon: "⊟", keywords: ["speaking time", "length", "duration", "minutes", "estimate", "words per minute"], run: () => setSlideLengthOpen(true) },
            { id: "data-claim", label: "Data Claim Checker (AI citation finder)", icon: "✦", keywords: ["data", "statistics", "claim", "citation", "source", "fact check", "ai"], run: () => setDataClaimOpen(true) },
            { id: "quote-finder", label: "Slide Quote Finder (find quoted text)", icon: "⊟", keywords: ["quote", "quotation", "cited text", "pullquote", "extract"], run: () => setQuoteFinderOpen(true) },
            { id: "abbreviation", label: "Abbreviation Finder (list all acronyms)", icon: "⊟", keywords: ["abbreviation", "acronym", "uppercase", "initialism", "short form"], run: () => setAbbreviationOpen(true) },
            { id: "mood-analyzer", label: "Presentation Mood Analyzer (AI tone read)", icon: "✦", keywords: ["mood", "tone", "emotion", "positivity", "feeling", "sentiment", "ai"], run: () => setMoodAnalyzerOpen(true) },
            { id: "jargon-finder", label: "Jargon Finder (AI audience accessibility check)", icon: "✦", keywords: ["jargon", "technical", "term", "audience", "accessibility", "simplify", "ai"], run: () => setJargonFinderOpen(true) },
            { id: "title-slide", label: "Title Slide Detector (find title/cover slides)", icon: "⊟", keywords: ["title", "cover", "opener", "header", "first slide", "section"], run: () => setTitleSlideOpen(true) },
            { id: "question-slide", label: "Question Slide Finder (slides with questions)", icon: "⊟", keywords: ["question", "q&a", "inquiry", "prompt", "?", "rhetorical"], run: () => setQuestionSlideOpen(true) },
            { id: "theme-extractor", label: "Slide Theme Extractor (AI key themes)", icon: "✦", keywords: ["theme", "topic", "subject", "thread", "motif", "ai"], run: () => setThemeExtractorOpen(true) },
            { id: "complexity-scorer", label: "Slide Complexity Scorer (shape + word score)", icon: "⊟", keywords: ["complexity", "busy", "overloaded", "score", "shapes", "density"], run: () => setComplexityScorerOpen(true) },
            { id: "title-length", label: "Slide Title Length Checker (flag long titles)", icon: "⊟", keywords: ["title", "length", "too long", "word count", "headline"], run: () => setTitleLengthOpen(true) },
            { id: "testimonial", label: "Testimonial Slide Finder (quote slides)", icon: "⊟", keywords: ["testimonial", "quote", "review", "endorsement", "attribution"], run: () => setTestimonialOpen(true) },
            { id: "sentiment-trend", label: "Slide Sentiment Trend (AI emotional arc)", icon: "✦", keywords: ["sentiment", "emotion", "arc", "trend", "mood", "positivity", "ai"], run: () => setSentimentTrendOpen(true) },
            { id: "color-count", label: "Color Count Per Slide (unique color audit)", icon: "⬛", keywords: ["color", "count", "unique", "palette", "fill", "rainbow"], run: () => setColorCountOpen(true) },
            { id: "font-size-audit", label: "Slide Font Size Audit (tiny text & variation)", icon: "⊟", keywords: ["font", "size", "pt", "small text", "too small", "varied", "typography"], run: () => setFontSizeAuditOpen(true) },
            { id: "notes-summary", label: "Presenter Notes Summarizer (AI briefing)", icon: "✦", keywords: ["notes", "speaker", "summarize", "briefing", "presenter", "ai"], run: () => setNotesSummaryOpen(true) },
            { id: "image-quality", label: "Slide Image Quality Checker (DPI & resolution)", icon: "⊟", keywords: ["image", "quality", "dpi", "resolution", "low res", "blurry"], run: () => setImageQualityOpen(true) },
            { id: "freshness", label: "Content Freshness Checker (AI stale data finder)", icon: "✦", keywords: ["freshness", "stale", "outdated", "old data", "statistics", "date", "ai"], run: () => setFreshnessOpen(true) },
            { id: "toc-gen", label: "Table of Contents Generator (AI slide grouping)", icon: "✦", keywords: ["table of contents", "toc", "generate", "outline", "sections", "ai"], run: () => setTocGenOpen(true) },
            { id: "risk-finder", label: "Risk Statement Finder (caveats & disclaimers)", icon: "⊟", keywords: ["risk", "caveat", "disclaimer", "limitation", "warning", "assumption"], run: () => setRiskFinderOpen(true) },
            { id: "visual-metaphor", label: "Visual Metaphor Checker (AI analogy finder)", icon: "✦", keywords: ["metaphor", "analogy", "symbol", "represent", "comparison", "ai"], run: () => setVisualMetaphorOpen(true) },
            { id: "action-plan", label: "Action Plan Extractor (next steps & tasks)", icon: "⊟", keywords: ["action", "task", "next step", "follow up", "todo", "plan"], run: () => setActionPlanOpen(true) },
            { id: "clear-all-notes", label: "Clear All Speaker Notes", icon: "⌀", keywords: ["clear", "delete", "remove", "speaker notes", "notes", "all"], run: async () => { if (confirm("Clear ALL speaker notes from every slide? This cannot be undone without using Undo.")) { try { const r = await clearNotes(doc.doc_id, "all"); alert(`Cleared speaker notes from ${r.cleared} slide${r.cleared !== 1 ? "s" : ""}`) } catch (e) { console.error("clear-notes failed:", e) } } } },
            { id: "fix-numbered-lists", label: "Fix Numbered Lists (normalize numbering)", icon: "1.", keywords: ["numbered", "list", "fix", "normalize", "sequence", "formatting"], run: async () => { try { const r = await fixNumberedLists(doc.doc_id); if (r.fixed > 0) { r.affected_slides.forEach((n) => markDirty(n)); setRefreshKey((k) => k + 1); alert(`Fixed numbered lists on ${r.affected_slides.length} slide${r.affected_slides.length !== 1 ? "s" : ""}`) } else { alert("No numbered lists found to fix.") } } catch (e) { console.error("fix-numbered-lists failed:", e) } } },
            { id: "polish-text", label: "AI Polish Slide Text (improve clarity)", icon: "✦", keywords: ["ai", "polish", "text", "improve", "clarity", "professional", "rewrite", "clean"], run: async () => { try { const r = await polishSlideText(doc.doc_id, selectedSlide, "professional", true); if (r.changed > 0) { markDirty(selectedSlide); setRefreshKey((k) => k + 1); alert(`Polished ${r.changed} text element${r.changed !== 1 ? "s" : ""} on slide ${selectedSlide}`) } else { alert("Text is already polished!") } } catch (e) { console.error("polish failed:", e) } } },
            { id: "export-stats-csv", label: "Export Analytics Report (CSV)", icon: "⬇", keywords: ["export", "stats", "analytics", "report", "csv", "download", "data", "spreadsheet"], run: () => { const a = document.createElement("a"); a.href = statsExportCsvUrl(doc.doc_id); a.download = "percy-stats.csv"; a.click() } },
            { id: "export-stats-json", label: "Export Analytics Report (JSON)", icon: "⬇", keywords: ["export", "stats", "analytics", "report", "json", "download", "data"], run: () => { const a = document.createElement("a"); a.href = statsExportJsonUrl(doc.doc_id); a.download = "percy-stats.json"; a.click() } },
            { id: "expand-slide", label: "AI Expand Slide (insert detail slide after)", icon: "✦", keywords: ["ai", "expand", "detail", "elaborate", "more", "insert", "slide", "follow-up"], run: async () => { try { const r = await expandSlide(doc.doc_id, selectedSlide); handleSlideCountChange(r.slide_count, r.new_slide_n); setRefreshKey((k) => k + 1) } catch (e) { console.error("expand-slide failed:", e) } } },
            ...(multiSelectIds.size >= 2 ? [{ id: "merge-elements", label: `Merge ${multiSelectIds.size} selected text elements`, icon: "⊞", keywords: ["merge", "combine", "join", "text", "elements"], run: async () => { try { await mergeElements(doc.doc_id, selectedSlide, [...multiSelectIds]); setMultiSelectIds(new Set()); setSelectedElement(null); markDirty(selectedSlide); setRefreshKey((k) => k + 1) } catch (e) { console.error("merge failed:", e) } } }] : []),
            { id: "summary-slide", label: "Insert AI Executive Summary Slide", icon: "✨", keywords: ["ai", "summary", "executive", "overview", "abstract", "insert", "slide"], run: async () => { try { const r = await insertSummarySlide(doc.doc_id, { position: "end" }); handleSlideCountChange(r.slide_count, r.new_slide_n); setRefreshKey((k) => k + 1) } catch (e) { console.error("summary slide failed:", e) } } },
            { id: "summary-slide-start", label: "Insert AI Executive Summary at Start", icon: "✨", keywords: ["ai", "summary", "start", "beginning", "first", "slide"], run: async () => { try { const r = await insertSummarySlide(doc.doc_id, { position: "start" }); handleSlideCountChange(r.slide_count, r.new_slide_n); setRefreshKey((k) => k + 1) } catch (e) { console.error("summary slide failed:", e) } } },
            { id: "optimize-layout", label: "AI Optimize Layout (balanced)", icon: "✨", keywords: ["ai", "layout", "optimize", "arrange", "position", "balance", "organize"], run: () => handleOptimizeLayout("balanced") },
            { id: "optimize-layout-title", label: "AI Optimize Layout (emphasize title)", icon: "✨", keywords: ["ai", "layout", "title", "emphasis", "header", "hero"], run: () => handleOptimizeLayout("emphasis-title") },
            { id: "optimize-layout-compact", label: "AI Optimize Layout (compact)", icon: "✨", keywords: ["ai", "layout", "compact", "tight", "dense"], run: () => handleOptimizeLayout("compact") },
            { id: "optimize-layout-spacious", label: "AI Optimize Layout (spacious)", icon: "✨", keywords: ["ai", "layout", "spacious", "open", "airy", "margins"], run: () => handleOptimizeLayout("spacious") },
            { id: "remove-watermarks", label: "Remove All Watermarks", icon: "⌀", keywords: ["remove", "delete", "watermark", "clean", "cleanup"], run: async () => { try { const r = await bulkDeleteElementsByName(doc.doc_id, "Watermark"); setRefreshKey((k) => k + 1); alert(`Removed ${r.removed} watermark element${r.removed !== 1 ? "s" : ""}`) } catch { /* ignore */ } } },
            { id: "remove-slide-numbers", label: "Remove All Slide Numbers", icon: "#", keywords: ["remove", "delete", "slide", "numbers", "cleanup"], run: async () => { try { const r = await bulkDeleteElementsByName(doc.doc_id, "SlideNumber_"); setRefreshKey((k) => k + 1); alert(`Removed ${r.removed} slide number element${r.removed !== 1 ? "s" : ""}`) } catch { /* ignore */ } } },
            { id: "layers", label: "Layers Panel", icon: "🗂", keywords: ["layers", "z-order", "stack"], run: () => setLayersOpen(true) },
            { id: "comments", label: "Comments", icon: "💬", keywords: ["comment", "annotation", "note"], run: () => setCommentsOpen(true) },
            { id: "shortcuts", label: "Keyboard Shortcuts", icon: "⌨", keywords: ["keys", "hotkeys", "help"], run: () => setShortcutsOpen(true) },
            { id: "outline-gen", label: "Generate from Outline", icon: "✨", keywords: ["ai", "generate", "outline", "create"], run: () => setOutlineGenOpen(true) },
            { id: "bulk-notes", label: "Generate Notes for All Slides (AI)", icon: "✨", keywords: ["ai", "notes", "bulk", "speaker"], run: async () => { try { const r = await generateNotesBulk(doc.doc_id); setRefreshKey((k) => k + 1); alert(`Generated notes for ${r.generated} slides`) } catch { /* ignore */ } } },
            { id: "add-slide", label: "Add New Slide at End", icon: "＋", keywords: ["new", "add", "insert", "create", "slide"], run: async () => { try { const r = await addSlide(doc.doc_id); handleSlideCountChange(r.slide_count, r.slide_count); setRefreshKey((k) => k + 1) } catch { /* ignore */ } } },
            { id: "dup-slide", label: `Duplicate Slide ${selectedSlide}`, icon: "⧉", keywords: ["duplicate", "copy", "clone", "slide"], run: async () => { try { const r = await duplicateSlide(doc.doc_id, selectedSlide); handleSlideCountChange(r.slide_count, r.new_slide_n ?? selectedSlide + 1); setRefreshKey((k) => k + 1) } catch { /* ignore */ } } },
            { id: "toggle-focus", label: focusMode ? "Exit Focus Mode" : "Enter Focus Mode", icon: "◻", keywords: ["focus", "fullscreen", "hide", "panels", "distraction"], run: () => setFocusMode((v) => !v) },
            { id: "toggle-pin", label: pinnedSlides.has(selectedSlide) ? `Unpin Slide ${selectedSlide}` : `Pin Slide ${selectedSlide}`, icon: "📌", keywords: ["pin", "bookmark", "mark", "slide", "favorite"], run: () => { const isPinned = pinnedSlides.has(selectedSlide); pinSlide(doc.doc_id, selectedSlide, !isPinned).then(() => setPinnedSlides((prev) => { const next = new Set(prev); if (isPinned) next.delete(selectedSlide); else next.add(selectedSlide); return next })).catch(() => {}) } },
            { id: "next-pin", label: "Jump to Next Pinned Slide", icon: "📌", keywords: ["pin", "next", "jump", "navigate", "pinned"], run: () => { const pins = [...pinnedSlides].sort((a, b) => a - b); if (pins.length > 0) { const next = pins.find((n) => n > selectedSlide) ?? pins[0]; setSelectedSlide(next); setSelectedElement(null) } } },
          ]}
        />
      )}

      {commentsOpen && (
        <CommentsPanel
          docId={doc.doc_id}
          slideN={selectedSlide}
          onClose={() => setCommentsOpen(false)}
        />
      )}

      {statsOpen && (
        <DocStatsModal
          docId={doc.doc_id}
          onClose={() => setStatsOpen(false)}
        />
      )}

      {checkOpen && (
        <PresentationCheckModal
          docId={doc.doc_id}
          onClose={() => setCheckOpen(false)}
          onJumpToSlide={(n) => setSelectedSlide(n)}
        />
      )}

      <ProjectShareModal
        projectId={doc.doc_id}
        projectName={doc.name}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
      />

      {colorSwapOpen && (
        <ColorSwapPanel
          docId={doc.doc_id}
          onClose={() => setColorSwapOpen(false)}
          onReplaced={(slides) => {
            if (slides.includes(selectedSlide)) setRefreshKey((k) => k + 1)
          }}
        />
      )}

      {fontSwapOpen && (
        <FontSwapPanel
          docId={doc.doc_id}
          onClose={() => setFontSwapOpen(false)}
          onReplaced={(slides) => {
            if (slides.includes(selectedSlide)) setRefreshKey((k) => k + 1)
          }}
        />
      )}

      {templateVarsOpen && (
        <TemplateVariablesPanel
          docId={doc.doc_id}
          onClose={() => setTemplateVarsOpen(false)}
          onApplied={() => setRefreshKey((k) => k + 1)}
        />
      )}

      {watermarkOpen && (
        <WatermarkModal
          docId={doc.doc_id}
          slideCount={localSlideCount}
          onClose={() => setWatermarkOpen(false)}
          onAdded={() => setRefreshKey((k) => k + 1)}
        />
      )}

      {transitionsOpen && (
        <TransitionsModal
          docId={doc.doc_id}
          slideCount={localSlideCount}
          currentSlide={selectedSlide}
          onClose={() => setTransitionsOpen(false)}
          onApplied={() => setRefreshKey((k) => k + 1)}
        />
      )}

      {compareOpen && (
        <SlideCompareModal
          docId={doc.doc_id}
          slideN={selectedSlide}
          slideCount={localSlideCount}
          onClose={() => setCompareOpen(false)}
          onJumpToSlide={(n) => setSelectedSlide(n)}
        />
      )}

      {grammarOpen && (
        <GrammarCheckModal
          docId={doc.doc_id}
          onClose={() => setGrammarOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
          onFixed={() => setRefreshKey((k) => k + 1)}
        />
      )}

      {themeGenOpen && (
        <ThemeGeneratorModal
          docId={doc.doc_id}
          onClose={() => setThemeGenOpen(false)}
          onApplied={() => setRefreshKey((k) => k + 1)}
        />
      )}

      {variationOpen && (
        <SlideVariationModal
          docId={doc.doc_id}
          slideN={selectedSlide}
          onClose={() => setVariationOpen(false)}
          onInserted={(newSlideN, newCount) => handleSlideCountChange(newCount, newSlideN)}
        />
      )}

      {translateOpen && (
        <TranslateModal
          docId={doc.doc_id}
          slideCount={localSlideCount}
          currentSlide={selectedSlide}
          onClose={() => setTranslateOpen(false)}
          onTranslated={(affectedSlides) => {
            if (affectedSlides.includes(selectedSlide)) setRefreshKey((k) => k + 1)
          }}
        />
      )}

      {reorderOpen && (
        <ReorderSuggestModal
          docId={doc.doc_id}
          slideCount={localSlideCount}
          onClose={() => setReorderOpen(false)}
          onApplied={(newCount) => {
            handleSlideCountChange(newCount, 1)
            setRefreshKey((k) => k + 1)
          }}
        />
      )}

      {similarOpen && (
        <SimilarSlidesModal
          docId={doc.doc_id}
          onClose={() => setSimilarOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {brandCheckOpen && (
        <BrandCheckModal
          docId={doc.doc_id}
          onClose={() => setBrandCheckOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {densityOpen && (
        <ContentDensityModal
          docId={doc.doc_id}
          onClose={() => setDensityOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {readabilityOpen && (
        <ReadabilityModal
          docId={doc.doc_id}
          onClose={() => setReadabilityOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {deckHealthOpen && (
        <DeckHealthModal
          docId={doc.doc_id}
          onClose={() => setDeckHealthOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
          onOpenFeature={(feature) => {
            setDeckHealthOpen(false)
            if (feature === "readability") setReadabilityOpen(true)
            else if (feature === "content-density") setDensityOpen(true)
            else if (feature === "similar-slides") setSimilarOpen(true)
            else if (feature === "presentation-check") setCheckOpen(true)
            else if (feature === "notes-review") setNotesReviewOpen(true)
          }}
        />
      )}

      {rehearsalOpen && (
        <RehearsalTimerModal
          docId={doc.doc_id}
          slideCount={localSlideCount}
          startSlide={selectedSlide}
          onClose={() => setRehearsalOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {snapshotOpen && (
        <SnapshotManagerModal
          docId={doc.doc_id}
          onClose={() => setSnapshotOpen(false)}
          onRestored={(slideCount) => {
            setLocalSlideCount(slideCount)
            setSelectedSlide(1)
            setSelectedElement(null)
            setRefreshKey((k) => k + 1)
          }}
        />
      )}

      {voiceoverOpen && (
        <VoiceoverScriptModal
          docId={doc.doc_id}
          onClose={() => setVoiceoverOpen(false)}
        />
      )}

      {deckSummaryOpen && (
        <DeckSummaryModal
          docId={doc.doc_id}
          onClose={() => setDeckSummaryOpen(false)}
        />
      )}

      {slideDiffOpen && (
        <SlideDiffModal
          docId={doc.doc_id}
          slideCount={localSlideCount}
          currentSlide={selectedSlide}
          onClose={() => setSlideDiffOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {actionItemsOpen && (
        <ActionItemsModal
          docId={doc.doc_id}
          onClose={() => setActionItemsOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {keywordsOpen && (
        <KeywordCloudModal
          docId={doc.doc_id}
          onClose={() => setKeywordsOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {questionsOpen && (
        <QuestionGeneratorModal
          docId={doc.doc_id}
          slideN={selectedSlide}
          slideCount={localSlideCount}
          onClose={() => setQuestionsOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {coachOpen && (
        <PresentationCoachModal
          docId={doc.doc_id}
          onClose={() => setCoachOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {titleOptOpen && (
        <TitleOptimizerModal
          docId={doc.doc_id}
          onClose={() => setTitleOptOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
          onApplied={() => { markDirty(selectedSlide); setRefreshKey((k) => k + 1) }}
        />
      )}

      {storyboardOpen && (
        <StoryboardModal
          docId={doc.doc_id}
          slideCount={localSlideCount}
          currentSlide={selectedSlide}
          onClose={() => setStoryboardOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {layoutIssuesOpen && (
        <LayoutIssuesModal
          docId={doc.doc_id}
          onClose={() => setLayoutIssuesOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
          onFixed={() => { setRefreshKey((k) => k + 1) }}
        />
      )}

      {audienceAdaptOpen && (
        <AudienceAdapterModal
          docId={doc.doc_id}
          slideCount={localSlideCount}
          currentSlide={selectedSlide}
          onClose={() => setAudienceAdaptOpen(false)}
          onApplied={() => { markDirty(selectedSlide); setRefreshKey((k) => k + 1) }}
        />
      )}

      {styleAuditOpen && (
        <StyleAuditModal
          docId={doc.doc_id}
          onClose={() => setStyleAuditOpen(false)}
        />
      )}

      {timerBudgetOpen && (
        <TimerBudgetModal
          docId={doc.doc_id}
          slideCount={localSlideCount}
          onClose={() => setTimerBudgetOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {readingLevelOpen && (
        <ReadingLevelModal
          docId={doc.doc_id}
          onClose={() => setReadingLevelOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {textCaseOpen && (
        <TextCaseModal
          docId={doc.doc_id}
          slideCount={localSlideCount}
          currentSlide={selectedSlide}
          onClose={() => setTextCaseOpen(false)}
          onApplied={(affected) => { affected.forEach((n) => markDirty(n)); setRefreshKey((k) => k + 1) }}
        />
      )}

      {impactScoresOpen && (
        <ImpactScoresModal
          docId={doc.doc_id}
          onClose={() => setImpactScoresOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {emotionalToneOpen && (
        <EmotionalToneModal
          docId={doc.doc_id}
          onClose={() => setEmotionalToneOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {imageGalleryOpen && (
        <ImageGalleryModal
          docId={doc.doc_id}
          onClose={() => setImageGalleryOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {accessibilityOpen && (
        <AccessibilityReportModal
          docId={doc.doc_id}
          onClose={() => setAccessibilityOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {autoTagOpen && (
        <AutoTagSlidesModal
          docId={doc.doc_id}
          onClose={() => setAutoTagOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {coverSlideOpen && (
        <CoverSlideModal
          docId={doc.doc_id}
          docName={doc.name}
          onClose={() => setCoverSlideOpen(false)}
          onCreated={(count) => { handleSlideCountChange(count, 1); setSelectedSlide(1); setRefreshKey((k) => k + 1) }}
        />
      )}

      {progressBarOpen && (
        <ProgressBarModal
          docId={doc.doc_id}
          slideCount={localSlideCount}
          onClose={() => setProgressBarOpen(false)}
          onApplied={() => setRefreshKey((k) => k + 1)}
        />
      )}

      {preflightOpen && (
        <PreflightModal
          docId={doc.doc_id}
          onClose={() => setPreflightOpen(false)}
        />
      )}

      {hookWriterOpen && (
        <HookWriterModal
          docId={doc.doc_id}
          slideN={selectedSlide}
          onClose={() => setHookWriterOpen(false)}
          onApplied={() => { markDirty(selectedSlide); setRefreshKey((k) => k + 1) }}
        />
      )}

      {sectionSepOpen && (
        <SectionSeparatorModal
          docId={doc.doc_id}
          slideCount={localSlideCount}
          currentSlide={selectedSlide}
          onClose={() => setSectionSepOpen(false)}
          onCreated={(newN, count) => { handleSlideCountChange(count, newN); setSelectedSlide(newN); setRefreshKey((k) => k + 1) }}
        />
      )}

      {formatPresetsOpen && (
        <FormatPresetsModal
          docId={doc.doc_id}
          slideCount={localSlideCount}
          currentSlide={selectedSlide}
          onClose={() => setFormatPresetsOpen(false)}
          onApplied={(affected) => { affected.forEach((n) => markDirty(n)); setRefreshKey((k) => k + 1) }}
        />
      )}

      {duplicateFinderOpen && (
        <DuplicateFinderModal
          docId={doc.doc_id}
          onClose={() => setDuplicateFinderOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {notesExpandOpen && (
        <NotesExpandModal
          docId={doc.doc_id}
          slideCount={localSlideCount}
          currentSlide={selectedSlide}
          onClose={() => setNotesExpandOpen(false)}
          onApplied={(n) => { markDirty(n); setRefreshKey((k) => k + 1) }}
        />
      )}

      {complexityOpen && (
        <ComplexityModal
          docId={doc.doc_id}
          onClose={() => setComplexityOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {contentGapsOpen && (
        <ContentGapsModal
          docId={doc.doc_id}
          onClose={() => setContentGapsOpen(false)}
        />
      )}

      {glossaryOpen && (
        <GlossaryModal
          docId={doc.doc_id}
          onClose={() => setGlossaryOpen(false)}
          onSlideInserted={() => setRefreshKey((k) => k + 1)}
        />
      )}

      {titleGenOpen && (
        <TitleGeneratorModal
          docId={doc.doc_id}
          slideCount={localSlideCount}
          currentSlide={selectedSlide}
          onClose={() => setTitleGenOpen(false)}
          onApplied={(affected) => { affected.forEach((n) => markDirty(n)); setRefreshKey((k) => k + 1) }}
        />
      )}

      {layoutAnalyzerOpen && (
        <LayoutAnalyzerModal
          docId={doc.doc_id}
          onClose={() => setLayoutAnalyzerOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {speakingPaceOpen && (
        <SpeakingPaceModal
          docId={doc.doc_id}
          onClose={() => setSpeakingPaceOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {citationOpen && (
        <CitationTrackerModal
          docId={doc.doc_id}
          onClose={() => setCitationOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {contrastOpen && (
        <ContrastCheckerModal
          docId={doc.doc_id}
          onClose={() => setContrastOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {qaPrepOpen && (
        <QAPrepModal
          docId={doc.doc_id}
          slideCount={localSlideCount}
          currentSlide={selectedSlide}
          onClose={() => setQaPrepOpen(false)}
        />
      )}

      {slideSummarizerOpen && (
        <SlideSummarizerModal
          docId={doc.doc_id}
          onClose={() => setSlideSummarizerOpen(false)}
          onApplied={() => setRefreshKey((k) => k + 1)}
        />
      )}

      {noteTemplateOpen && (
        <NoteTemplateModal
          docId={doc.doc_id}
          slideCount={localSlideCount}
          currentSlide={selectedSlide}
          onClose={() => setNoteTemplateOpen(false)}
          onApplied={(n) => { markDirty(n); setRefreshKey((k) => k + 1) }}
        />
      )}

      {keywordSpotlightOpen && (
        <KeywordSpotlightModal
          docId={doc.doc_id}
          onClose={() => setKeywordSpotlightOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {textStatsOpen && (
        <TextStatsModal
          docId={doc.doc_id}
          onClose={() => setTextStatsOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {emojiRemoverOpen && (
        <EmojiRemoverModal
          docId={doc.doc_id}
          slideCount={localSlideCount}
          onClose={() => setEmojiRemoverOpen(false)}
          onApplied={(affected) => { affected.forEach((n) => markDirty(n)); setRefreshKey((k) => k + 1) }}
        />
      )}

      {capitalizeTitlesOpen && (
        <CapitalizeTitlesModal
          docId={doc.doc_id}
          slideCount={localSlideCount}
          currentSlide={selectedSlide}
          onClose={() => setCapitalizeTitlesOpen(false)}
          onApplied={(affected) => { affected.forEach((n) => markDirty(n)); setRefreshKey((k) => k + 1) }}
        />
      )}

      {pullQuoteOpen && (
        <PullQuoteModal
          docId={doc.doc_id}
          onClose={() => setPullQuoteOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {flowFeedbackOpen && (
        <FlowFeedbackModal
          docId={doc.doc_id}
          onClose={() => setFlowFeedbackOpen(false)}
        />
      )}

      {footnoteOpen && (
        <FootnoteModal
          docId={doc.doc_id}
          slideCount={localSlideCount}
          currentSlide={selectedSlide}
          onClose={() => setFootnoteOpen(false)}
          onAdded={(n) => { markDirty(n); setRefreshKey((k) => k + 1) }}
        />
      )}

      {wordCloudOpen && (
        <WordCloudModal
          docId={doc.doc_id}
          slideCount={localSlideCount}
          currentSlide={selectedSlide}
          onClose={() => setWordCloudOpen(false)}
        />
      )}

      {colorPaletteOpen && (
        <ColorPaletteModal
          docId={doc.doc_id}
          onClose={() => setColorPaletteOpen(false)}
        />
      )}

      {slideLabelsOpen && (
        <SlideLabelsModal
          docId={doc.doc_id}
          slideCount={localSlideCount}
          currentSlide={selectedSlide}
          onClose={() => setSlideLabelsOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {deckTitleOpen && (
        <DeckTitleModal
          docId={doc.doc_id}
          onClose={() => setDeckTitleOpen(false)}
        />
      )}

      {blankSlideOpen && (
        <BlankSlideModal
          docId={doc.doc_id}
          onClose={() => setBlankSlideOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {slideProgressOpen && (
        <SlideProgressModal
          docId={doc.doc_id}
          onClose={() => setSlideProgressOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {highlightReelOpen && (
        <HighlightReelModal
          docId={doc.doc_id}
          slideCount={localSlideCount}
          onClose={() => setHighlightReelOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {fontAuditOpen && (
        <FontAuditModal
          docId={doc.doc_id}
          onClose={() => setFontAuditOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {execBriefingOpen && (
        <ExecutiveBriefingModal
          docId={doc.doc_id}
          onClose={() => setExecBriefingOpen(false)}
        />
      )}

      {marginCheckOpen && (
        <MarginCheckModal
          docId={doc.doc_id}
          onClose={() => setMarginCheckOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {deckTaglineOpen && (
        <DeckTaglineModal
          docId={doc.doc_id}
          onClose={() => setDeckTaglineOpen(false)}
          onApplied={() => { markDirty(1); setRefreshKey((k) => k + 1) }}
        />
      )}

      {sectionWordCountOpen && (
        <SectionWordCountModal
          docId={doc.doc_id}
          onClose={() => setSectionWordCountOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {complexityHeatmapOpen && (
        <ComplexityHeatmapModal
          docId={doc.doc_id}
          onClose={() => setComplexityHeatmapOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {reorderRationaleOpen && (
        <ReorderRationaleModal
          docId={doc.doc_id}
          onClose={() => setReorderRationaleOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {readingOrderOpen && (
        <ReadingOrderModal
          docId={doc.doc_id}
          onClose={() => setReadingOrderOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {titleCritiqueOpen && (
        <TitleSlideCritiqueModal
          docId={doc.doc_id}
          onClose={() => setTitleCritiqueOpen(false)}
        />
      )}

      {clutterScoreOpen && (
        <ClutterScoreModal
          docId={doc.doc_id}
          onClose={() => setClutterScoreOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {ctaSlideOpen && (
        <CTASlideModal
          docId={doc.doc_id}
          onClose={() => setCtaSlideOpen(false)}
          onInserted={(n, count) => { handleSlideCountChange(count, n); setRefreshKey((k) => k + 1) }}
        />
      )}

      {openingHookOpen && (
        <OpeningHookModal
          docId={doc.doc_id}
          onClose={() => setOpeningHookOpen(false)}
          onApplied={() => { markDirty(1); setRefreshKey((k) => k + 1) }}
        />
      )}

      {tocCheckOpen && (
        <TOCCheckModal
          docId={doc.doc_id}
          onClose={() => setTocCheckOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {linkCheckerOpen && (
        <LinkCheckerModal
          docId={doc.doc_id}
          onClose={() => setLinkCheckerOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {metaphorOpen && (
        <MetaphorFinderModal
          docId={doc.doc_id}
          onClose={() => setMetaphorOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {speakerConfidenceOpen && (
        <SpeakerConfidenceModal
          docId={doc.doc_id}
          onClose={() => setSpeakerConfidenceOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {styleGuideOpen && (
        <StyleGuideModal
          docId={doc.doc_id}
          onClose={() => setStyleGuideOpen(false)}
        />
      )}

      {agendaSyncOpen && (
        <AgendaSyncModal
          docId={doc.doc_id}
          onClose={() => setAgendaSyncOpen(false)}
          onApplied={(n) => { markDirty(n); setRefreshKey((k) => k + 1) }}
        />
      )}

      {paceCheckerOpen && (
        <PaceCheckerModal
          docId={doc.doc_id}
          onClose={() => setPaceCheckerOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {counterArgsOpen && (
        <CounterArgumentsModal
          docId={doc.doc_id}
          onClose={() => setCounterArgsOpen(false)}
        />
      )}

      {humorOpen && (
        <HumorSuggestionsModal
          docId={doc.doc_id}
          onClose={() => setHumorOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {dataTableOpen && (
        <DataTableModal
          docId={doc.doc_id}
          onClose={() => setDataTableOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {alignmentAuditOpen && (
        <AlignmentAuditModal
          docId={doc.doc_id}
          onClose={() => setAlignmentAuditOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {notesLengthOpen && (
        <NotesLengthModal
          docId={doc.doc_id}
          onClose={() => setNotesLengthOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {deckQuizOpen && (
        <DeckQuizModal
          docId={doc.doc_id}
          onClose={() => setDeckQuizOpen(false)}
        />
      )}

      {backgroundAuditOpen && (
        <BackgroundAuditModal
          docId={doc.doc_id}
          onClose={() => setBackgroundAuditOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {placeholderOpen && (
        <PlaceholderFinderModal
          docId={doc.doc_id}
          onClose={() => setPlaceholderOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {actionPlanOpen && (
        <ActionPlanModal
          docId={doc.doc_id}
          onClose={() => setActionPlanOpen(false)}
        />
      )}

      {sectionTitleOpen && (
        <SectionTitleModal
          docId={doc.doc_id}
          onClose={() => setSectionTitleOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {bookmarkOpen && (
        <BookmarkManagerModal
          docId={doc.doc_id}
          currentSlide={selectedSlide}
          onClose={() => setBookmarkOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {dataInsightsOpen && (
        <DataInsightsModal
          docId={doc.doc_id}
          onClose={() => setDataInsightsOpen(false)}
        />
      )}

      {narrativeArcOpen && (
        <NarrativeArcModal
          docId={doc.doc_id}
          onClose={() => setNarrativeArcOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {gridCheckOpen && (
        <GridCheckModal
          docId={doc.doc_id}
          onClose={() => setGridCheckOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {persuasionScoreOpen && (
        <PersuasionScoreModal
          docId={doc.doc_id}
          onClose={() => setPersuasionScoreOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {socialSnippetsOpen && (
        <SocialSnippetsModal
          docId={doc.doc_id}
          onClose={() => setSocialSnippetsOpen(false)}
        />
      )}

      {textOverflowOpen && (
        <TextOverflowModal
          docId={doc.doc_id}
          onClose={() => setTextOverflowOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {audienceQuestionsOpen && (
        <AudienceQuestionsModal
          docId={doc.doc_id}
          slideN={selectedSlide}
          onClose={() => setAudienceQuestionsOpen(false)}
        />
      )}

      {toneConsistencyOpen && (
        <ToneConsistencyModal
          docId={doc.doc_id}
          onClose={() => setToneConsistencyOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {sentenceVarietyOpen && (
        <SentenceVarietyModal
          docId={doc.doc_id}
          onClose={() => setSentenceVarietyOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {exportChecklistOpen && (
        <ExportChecklistModal
          docId={doc.doc_id}
          onClose={() => setExportChecklistOpen(false)}
        />
      )}

      {imageDescOpen && (
        <ImageDescriptionsModal
          docId={doc.doc_id}
          currentSlide={selectedSlide}
          onClose={() => setImageDescOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {redundancyOpen && (
        <RedundancyFinderModal
          docId={doc.doc_id}
          onClose={() => setRedundancyOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {passiveVoiceOpen && (
        <PassiveVoiceModal
          docId={doc.doc_id}
          onClose={() => setPassiveVoiceOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {emotionalKwOpen && (
        <EmotionalKeywordsModal
          docId={doc.doc_id}
          onClose={() => setEmotionalKwOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {deckCompareOpen && (
        <DeckCompareModal
          docId={doc.doc_id}
          onClose={() => setDeckCompareOpen(false)}
        />
      )}

      {jargonOpen && (
        <JargonDetectorModal
          docId={doc.doc_id}
          onClose={() => setJargonOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {storyArcOpen && (
        <StoryArcModal
          docId={doc.doc_id}
          onClose={() => setStoryArcOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {fillerWordsOpen && (
        <FillerWordsModal
          docId={doc.doc_id}
          onClose={() => setFillerWordsOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {acronymOpen && (
        <AcronymExplainerModal
          docId={doc.doc_id}
          onClose={() => setAcronymOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {weakVerbsOpen && (
        <WeakVerbsModal
          docId={doc.doc_id}
          onClose={() => setWeakVerbsOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {bulletAnalysisOpen && (
        <BulletAnalysisModal
          docId={doc.doc_id}
          onClose={() => setBulletAnalysisOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {timerEstimateOpen && (
        <TimerEstimateModal
          docId={doc.doc_id}
          onClose={() => setTimerEstimateOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {colorReportOpen && (
        <ColorReportModal
          docId={doc.doc_id}
          onClose={() => setColorReportOpen(false)}
        />
      )}

      {whitespaceOpen && (
        <WhitespaceModal
          docId={doc.doc_id}
          onClose={() => setWhitespaceOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {fontPairingOpen && (
        <FontPairingModal
          docId={doc.doc_id}
          onClose={() => setFontPairingOpen(false)}
        />
      )}

      {sectionSummaryOpen && (
        <SectionSummaryModal
          docId={doc.doc_id}
          totalSlides={localSlideCount}
          onClose={() => setSectionSummaryOpen(false)}
        />
      )}

      {firstImpressionOpen && (
        <FirstImpressionModal
          docId={doc.doc_id}
          onClose={() => setFirstImpressionOpen(false)}
        />
      )}

      {ctaStrengthOpen && (
        <CTAStrengthModal
          docId={doc.doc_id}
          onClose={() => setCtaStrengthOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {keywordDensityOpen && (
        <KeywordDensityModal
          docId={doc.doc_id}
          onClose={() => setKeywordDensityOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {repetitionHeatmapOpen && (
        <RepetitionHeatmapModal
          docId={doc.doc_id}
          onClose={() => setRepetitionHeatmapOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {claimCheckerOpen && (
        <ClaimCheckerModal
          docId={doc.doc_id}
          onClose={() => setClaimCheckerOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {discussionQxOpen && (
        <DiscussionQuestionsModal
          docId={doc.doc_id}
          onClose={() => setDiscussionQxOpen(false)}
        />
      )}

      {vocabularyOpen && (
        <VocabularyLevelModal
          docId={doc.doc_id}
          onClose={() => setVocabularyOpen(false)}
        />
      )}

      {completenessOpen && (
        <CompletenessReportModal
          docId={doc.doc_id}
          onClose={() => setCompletenessOpen(false)}
        />
      )}

      {visualHierarchyOpen && (
        <VisualHierarchyModal
          docId={doc.doc_id}
          onClose={() => setVisualHierarchyOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {sentimentArcOpen && (
        <SentimentArcModal
          docId={doc.doc_id}
          onClose={() => setSentimentArcOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {taglineVarsOpen && (
        <TaglineVariationsModal
          docId={doc.doc_id}
          onClose={() => setTaglineVarsOpen(false)}
        />
      )}

      {slideLengthOpen && (
        <SlideLengthModal
          docId={doc.doc_id}
          onClose={() => setSlideLengthOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {transitionPacingOpen && (
        <TransitionPacingModal
          docId={doc.doc_id}
          onClose={() => setTransitionPacingOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {hookStrengthOpen && (
        <HookStrengthModal
          docId={doc.doc_id}
          onClose={() => setHookStrengthOpen(false)}
        />
      )}

      {dataDensityOpen && (
        <DataDensityModal
          docId={doc.doc_id}
          onClose={() => setDataDensityOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {closingImpactOpen && (
        <ClosingImpactModal
          docId={doc.doc_id}
          onClose={() => setClosingImpactOpen(false)}
        />
      )}

      {redundantSlidesOpen && (
        <RedundantSlidesModal
          docId={doc.doc_id}
          onClose={() => setRedundantSlidesOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {toneShiftOpen && (
        <ToneShiftModal
          docId={doc.doc_id}
          onClose={() => setToneShiftOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {persuasionFwOpen && (
        <PersuasionFrameworkModal
          docId={doc.doc_id}
          onClose={() => setPersuasionFwOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {confidenceScoresOpen && (
        <ConfidenceScoresModal
          docId={doc.doc_id}
          onClose={() => setConfidenceScoresOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {complexityIndexOpen && (
        <ComplexityIndexModal
          docId={doc.doc_id}
          onClose={() => setComplexityIndexOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {quoteExtractorOpen && (
        <QuoteExtractorModal
          docId={doc.doc_id}
          onClose={() => setQuoteExtractorOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {presentationRisksOpen && (
        <PresentationRisksModal
          docId={doc.doc_id}
          onClose={() => setPresentationRisksOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {audienceFitOpen && (
        <AudienceFitModal
          docId={doc.doc_id}
          onClose={() => setAudienceFitOpen(false)}
        />
      )}

      {analogyFinderOpen && (
        <AnalogyFinderModal
          docId={doc.doc_id}
          onClose={() => setAnalogyFinderOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {actionVerbsOpen && (
        <ActionVerbsModal
          docId={doc.doc_id}
          onClose={() => setActionVerbsOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {emotionalPayoffOpen && (
        <EmotionalPayoffModal
          docId={doc.doc_id}
          onClose={() => setEmotionalPayoffOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {clarityScoreOpen && (
        <ClarityScoreModal
          docId={doc.doc_id}
          onClose={() => setClarityScoreOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {buzzwordDensityOpen && (
        <BuzzwordDensityModal
          docId={doc.doc_id}
          onClose={() => setBuzzwordDensityOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {slideIntentOpen && (
        <SlideIntentModal
          docId={doc.doc_id}
          onClose={() => setSlideIntentOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {narrativeGapsOpen && (
        <NarrativeGapsModal
          docId={doc.doc_id}
          onClose={() => setNarrativeGapsOpen(false)}
        />
      )}

      {evidenceAuditOpen && (
        <EvidenceAuditModal
          docId={doc.doc_id}
          onClose={() => setEvidenceAuditOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {competitiveLangOpen && (
        <CompetitiveLanguageModal
          docId={doc.doc_id}
          onClose={() => setCompetitiveLangOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {metaphorDensityOpen && (
        <MetaphorDensityModal
          docId={doc.doc_id}
          onClose={() => setMetaphorDensityOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {impactRankingOpen && (
        <ImpactRankingModal
          docId={doc.doc_id}
          onClose={() => setImpactRankingOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {contentBalanceOpen && (
        <ContentBalanceModal
          docId={doc.doc_id}
          onClose={() => setContentBalanceOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {speakerDensityOpen && (
        <SpeakerDensityModal
          docId={doc.doc_id}
          onClose={() => setSpeakerDensityOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {acronymMapOpen && (
        <AcronymMapModal
          docId={doc.doc_id}
          onClose={() => setAcronymMapOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {promiseTrackerOpen && (
        <PromiseTrackerModal
          docId={doc.doc_id}
          onClose={() => setPromiseTrackerOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {slideRepetitionOpen && (
        <SlideRepetitionModal
          docId={doc.doc_id}
          onClose={() => setSlideRepetitionOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {numericConsistOpen && (
        <NumericConsistencyModal
          docId={doc.doc_id}
          onClose={() => setNumericConsistOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {titleUniquenessOpen && (
        <TitleUniquenessModal
          docId={doc.doc_id}
          onClose={() => setTitleUniquenessOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {deckPunchlineOpen && (
        <DeckPunchlineModal
          docId={doc.doc_id}
          onClose={() => setDeckPunchlineOpen(false)}
        />
      )}

      {openingStatsOpen && (
        <OpeningStatsModal
          docId={doc.doc_id}
          onClose={() => setOpeningStatsOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {urgencyDetectorOpen && (
        <UrgencyDetectorModal
          docId={doc.doc_id}
          onClose={() => setUrgencyDetectorOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {questionCountOpen && (
        <QuestionCountModal
          docId={doc.doc_id}
          onClose={() => setQuestionCountOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {valuePropOpen && (
        <ValuePropositionModal
          docId={doc.doc_id}
          onClose={() => setValuePropOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {topicCoverageOpen && (
        <TopicCoverageModal
          docId={doc.doc_id}
          onClose={() => setTopicCoverageOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {densityHeatmapOpen && (
        <DensityHeatmapModal
          docId={doc.doc_id}
          onClose={() => setDensityHeatmapOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {presentationDNAOpen && (
        <PresentationDNAModal
          docId={doc.doc_id}
          onClose={() => setPresentationDNAOpen(false)}
        />
      )}

      {speakerTipsOpen && (
        <SpeakerTipsModal
          docId={doc.doc_id}
          onClose={() => setSpeakerTipsOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {objectionHandlerOpen && (
        <ObjectionHandlerModal
          docId={doc.doc_id}
          onClose={() => setObjectionHandlerOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {slideQuestionsOpen && (
        <SlideQuestionsModal
          docId={doc.doc_id}
          onClose={() => setSlideQuestionsOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {deckManifestoOpen && (
        <DeckManifestoModal
          docId={doc.doc_id}
          onClose={() => setDeckManifestoOpen(false)}
        />
      )}

      {bulletBrevityOpen && (
        <BulletBrevityModal
          docId={doc.doc_id}
          onClose={() => setBulletBrevityOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {insightExtractorOpen && (
        <InsightExtractorModal
          docId={doc.doc_id}
          onClose={() => setInsightExtractorOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {slideTransInfoOpen && (
        <SlideTransitionsInfoModal
          docId={doc.doc_id}
          onClose={() => setSlideTransInfoOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {storyGapFillerOpen && (
        <StoryGapFillerModal
          docId={doc.doc_id}
          onClose={() => setStoryGapFillerOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {imageTextRatioOpen && (
        <ImageTextRatioModal
          docId={doc.doc_id}
          onClose={() => setImageTextRatioOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {metaphorSuggesterOpen && (
        <MetaphorSuggesterModal
          docId={doc.doc_id}
          onClose={() => setMetaphorSuggesterOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {emojiUsageOpen && (
        <EmojiUsageModal
          docId={doc.doc_id}
          onClose={() => setEmojiUsageOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {slideMoodBoardOpen && (
        <SlideMoodBoardModal
          docId={doc.doc_id}
          onClose={() => setSlideMoodBoardOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {longSentencesOpen && (
        <LongSentencesModal
          docId={doc.doc_id}
          onClose={() => setLongSentencesOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {elevatorPitchOpen && (
        <DeckElevatorPitchModal
          docId={doc.doc_id}
          onClose={() => setElevatorPitchOpen(false)}
        />
      )}

      {headerFooterOpen && (
        <HeaderFooterCheckModal
          docId={doc.doc_id}
          onClose={() => setHeaderFooterOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {sectionIntrosOpen && (
        <SectionIntrosModal
          docId={doc.doc_id}
          onClose={() => setSectionIntrosOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {textAlignAuditOpen && (
        <TextAlignmentAuditModal
          docId={doc.doc_id}
          onClose={() => setTextAlignAuditOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {reframeSuggestOpen && (
        <ReframeSuggestionsModal
          docId={doc.doc_id}
          onClose={() => setReframeSuggestOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {passiveConstructOpen && (
        <PassiveConstructionsModal
          docId={doc.doc_id}
          onClose={() => setPassiveConstructOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {slideTaglinesOpen && (
        <SlideTaglinesModal
          docId={doc.doc_id}
          onClose={() => setSlideTaglinesOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {punctuationAuditOpen && (
        <PunctuationAuditModal
          docId={doc.doc_id}
          onClose={() => setPunctuationAuditOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {authoritySignalsOpen && (
        <AuthoritySignalsModal
          docId={doc.doc_id}
          onClose={() => setAuthoritySignalsOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {shapeInventoryOpen && (
        <ShapeInventoryModal
          docId={doc.doc_id}
          onClose={() => setShapeInventoryOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {assumptionCheckerOpen && (
        <AssumptionCheckerModal
          docId={doc.doc_id}
          onClose={() => setAssumptionCheckerOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {fontSizeDistOpen && (
        <FontSizeDistributionModal
          docId={doc.doc_id}
          onClose={() => setFontSizeDistOpen(false)}
        />
      )}

      {keyMessageOpen && (
        <KeyMessageExtractorModal
          docId={doc.doc_id}
          onClose={() => setKeyMessageOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {textColorAuditOpen && (
        <TextColorAuditModal
          docId={doc.doc_id}
          onClose={() => setTextColorAuditOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {competitivePosOpen && (
        <CompetitivePositioningModal
          docId={doc.doc_id}
          onClose={() => setCompetitivePosOpen(false)}
        />
      )}

      {emptyNotesOpen && (
        <EmptyNotesFinderModal
          docId={doc.doc_id}
          onClose={() => setEmptyNotesOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {deckQuizGenOpen && (
        <DeckQuizGeneratorModal
          docId={doc.doc_id}
          onClose={() => setDeckQuizGenOpen(false)}
        />
      )}

      {slideSymmetryOpen && (
        <SlideSymmetryModal
          docId={doc.doc_id}
          onClose={() => setSlideSymmetryOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {objectionMapOpen && (
        <ObjectionMapModal
          docId={doc.doc_id}
          onClose={() => setObjectionMapOpen(false)}
        />
      )}

      {textDensityWordOpen && (
        <TextDensityPerWordModal
          docId={doc.doc_id}
          onClose={() => setTextDensityWordOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {storyBeatsOpen && (
        <SlideStoryBeatsModal
          docId={doc.doc_id}
          onClose={() => setStoryBeatsOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {placeholderFinderOpen && (
        <PlaceholderTextFinderModal
          docId={doc.doc_id}
          onClose={() => setPlaceholderFinderOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {audienceJourneyOpen && (
        <AudienceJourneyMapModal
          docId={doc.doc_id}
          onClose={() => setAudienceJourneyOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {linkDensityOpen && (
        <LinkDensityModal
          docId={doc.doc_id}
          onClose={() => setLinkDensityOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {summaryBulletsOpen && (
        <PresentationSummaryBulletsModal
          docId={doc.doc_id}
          onClose={() => setSummaryBulletsOpen(false)}
        />
      )}

      {colorContrastOpen && (
        <ColorContrastAuditModal
          docId={doc.doc_id}
          onClose={() => setColorContrastOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {deckPersonalityOpen && (
        <DeckPersonalityModal
          docId={doc.doc_id}
          onClose={() => setDeckPersonalityOpen(false)}
        />
      )}

      {titleLengthOpen && (
        <TitleLengthAuditModal
          docId={doc.doc_id}
          onClose={() => setTitleLengthOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {ctaFinderOpen && (
        <CallToActionFinderModal
          docId={doc.doc_id}
          onClose={() => setCtaFinderOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {wordHistogramOpen && (
        <SlideWordCountHistogramModal
          docId={doc.doc_id}
          onClose={() => setWordHistogramOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {rhetoricalOpen && (
        <RhetoricalDeviceFinderModal
          docId={doc.doc_id}
          onClose={() => setRhetoricalOpen(false)}
        />
      )}

      {zOrderOpen && (
        <ShapeZOrderAuditModal
          docId={doc.doc_id}
          onClose={() => setZOrderOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {compGapOpen && (
        <CompetitiveGapAnalyzerModal
          docId={doc.doc_id}
          onClose={() => setCompGapOpen(false)}
        />
      )}

      {bulletCountOpen && (
        <BulletCountPerSlideModal
          docId={doc.doc_id}
          onClose={() => setBulletCountOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {hookAnalyzerOpen && (
        <SlideHookAnalyzerModal
          docId={doc.doc_id}
          onClose={() => setHookAnalyzerOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {imgCaptionOpen && (
        <ImageCaptionCheckerModal
          docId={doc.doc_id}
          onClose={() => setImgCaptionOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {dataStoryOpen && (
        <DataStoryCheckerModal
          docId={doc.doc_id}
          onClose={() => setDataStoryOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {pacingOpen && (
        <SlidePacingScoreModal
          docId={doc.doc_id}
          onClose={() => setPacingOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {trustSignalOpen && (
        <TrustSignalFinderModal
          docId={doc.doc_id}
          onClose={() => setTrustSignalOpen(false)}
        />
      )}

      {repeatedWordsOpen && (
        <RepeatedWordsAuditModal
          docId={doc.doc_id}
          onClose={() => setRepeatedWordsOpen(false)}
        />
      )}

      {transitionsAdvisorOpen && (
        <SlideTransitionsAdvisorModal
          docId={doc.doc_id}
          onClose={() => setTransitionsAdvisorOpen(false)}
        />
      )}

      {layoutAuditOpen && (
        <SlideLayoutTypeAuditModal
          docId={doc.doc_id}
          onClose={() => setLayoutAuditOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {openingCloserOpen && (
        <OpeningCloserEvaluatorModal
          docId={doc.doc_id}
          onClose={() => setOpeningCloserOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {acronymOpen && (
        <AcronymFinderModal
          docId={doc.doc_id}
          onClose={() => setAcronymOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {complexityRankerOpen && (
        <SlideComplexityRankerModal
          docId={doc.doc_id}
          onClose={() => setComplexityRankerOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {numberedListOpen && (
        <NumberedListConsistencyModal
          docId={doc.doc_id}
          onClose={() => setNumberedListOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {persuasionOpen && (
        <PersuasionFrameworkDetectorModal
          docId={doc.doc_id}
          onClose={() => setPersuasionOpen(false)}
        />
      )}

      {boundsCheckOpen && (
        <SlideAspectRatioCheckModal
          docId={doc.doc_id}
          onClose={() => setBoundsCheckOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {valuePropExtractOpen && (
        <ValuePropositionExtractorModal
          docId={doc.doc_id}
          onClose={() => setValuePropExtractOpen(false)}
        />
      )}

      {chartCountOpen && (
        <ChartCountPerSlideModal
          docId={doc.doc_id}
          onClose={() => setChartCountOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {narrativeArcOpen && (
        <NarrativeArcScorerModal
          docId={doc.doc_id}
          onClose={() => setNarrativeArcOpen(false)}
        />
      )}

      {duplicateSlideOpen && (
        <DuplicateSlideDetectorModal
          docId={doc.doc_id}
          onClose={() => setDuplicateSlideOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {reorderAdvisorOpen && (
        <SlideReorderAdvisorModal
          docId={doc.doc_id}
          onClose={() => setReorderAdvisorOpen(false)}
        />
      )}

      {tableCountOpen && (
        <TableCountAuditModal
          docId={doc.doc_id}
          onClose={() => setTableCountOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {emotionalToneOpen && (
        <EmotionalToneProfilerModal
          docId={doc.doc_id}
          onClose={() => setEmotionalToneOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {headingHierarchyOpen && (
        <HeadingHierarchyCheckModal
          docId={doc.doc_id}
          onClose={() => setHeadingHierarchyOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {pitchReadinessOpen && (
        <PitchReadinessScoreModal
          docId={doc.doc_id}
          onClose={() => setPitchReadinessOpen(false)}
        />
      )}

      {fontVarietyOpen && (
        <FontVarietyAuditModal
          docId={doc.doc_id}
          onClose={() => setFontVarietyOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {metaphorOpen && (
        <SlideMetaphorFinderModal
          docId={doc.doc_id}
          onClose={() => setMetaphorOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {emptySlideOpen && (
        <EmptySlideDetectorModal
          docId={doc.doc_id}
          onClose={() => setEmptySlideOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {closingStrengthOpen && (
        <ClosingStrengthEvaluatorModal
          docId={doc.doc_id}
          onClose={() => setClosingStrengthOpen(false)}
        />
      )}

      {titleUniquenessOpen && (
        <SlideTitleUniquenessModal
          docId={doc.doc_id}
          onClose={() => setTitleUniquenessOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {openingHookOpen && (
        <OpeningHookRaterModal
          docId={doc.doc_id}
          onClose={() => setOpeningHookOpen(false)}
        />
      )}

      {speakerNoteLenOpen && (
        <SpeakerNoteLengthCheckerModal
          docId={doc.doc_id}
          onClose={() => setSpeakerNoteLenOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {competitorMentionOpen && (
        <CompetitorMentionFinderModal
          docId={doc.doc_id}
          onClose={() => setCompetitorMentionOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {slideImageCountOpen && (
        <SlideImageCountModal
          docId={doc.doc_id}
          onClose={() => setSlideImageCountOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {taglineGenOpen && (
        <PresentationTaglineGeneratorModal
          docId={doc.doc_id}
          onClose={() => setTaglineGenOpen(false)}
        />
      )}

      {longSentenceOpen && (
        <LongSentenceDetectorModal
          docId={doc.doc_id}
          onClose={() => setLongSentenceOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {stakeholderConcernOpen && (
        <StakeholderConcernMapperModal
          docId={doc.doc_id}
          onClose={() => setStakeholderConcernOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {colorPaletteOpen && (
        <SlideColorPaletteModal
          docId={doc.doc_id}
          onClose={() => setColorPaletteOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {contentDensityOpen && (
        <ContentDensityScorerModal
          docId={doc.doc_id}
          onClose={() => setContentDensityOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {bulletLengthOpen && (
        <BulletLengthAuditModal
          docId={doc.doc_id}
          onClose={() => setBulletLengthOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {gapFillerOpen && (
        <PresentationGapFillerModal
          docId={doc.doc_id}
          onClose={() => setGapFillerOpen(false)}
        />
      )}

      {shapeCountOpen && (
        <ShapeCountPerSlideModal
          docId={doc.doc_id}
          onClose={() => setShapeCountOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {titleImproverOpen && (
        <SlideTitleImproverModal
          docId={doc.doc_id}
          onClose={() => setTitleImproverOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {numericDataOpen && (
        <NumericDataSpotterModal
          docId={doc.doc_id}
          onClose={() => setNumericDataOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {objectionHandlerOpen && (
        <ObjectionHandlerGeneratorModal
          docId={doc.doc_id}
          onClose={() => setObjectionHandlerOpen(false)}
        />
      )}

      {textCaseOpen && (
        <TextCaseAuditModal
          docId={doc.doc_id}
          onClose={() => setTextCaseOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {audiencePersonaOpen && (
        <AudiencePersonaBuilderModal
          docId={doc.doc_id}
          onClose={() => setAudiencePersonaOpen(false)}
        />
      )}

      {footnoteFinderOpen && (
        <SlideFootnoteFinderModal
          docId={doc.doc_id}
          onClose={() => setFootnoteFinderOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {execSummaryOpen && (
        <DeckExecutiveSummaryModal
          docId={doc.doc_id}
          onClose={() => setExecSummaryOpen(false)}
        />
      )}

      {hyperlinkAuditOpen && (
        <SlideHyperlinkAuditModal
          docId={doc.doc_id}
          onClose={() => setHyperlinkAuditOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {persuasionRaterOpen && (
        <PersuasionIntensityRaterModal
          docId={doc.doc_id}
          onClose={() => setPersuasionRaterOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {iconographyOpen && (
        <ConsistentIconographyCheckModal
          docId={doc.doc_id}
          onClose={() => setIconographyOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {onePageSummaryOpen && (
        <OnePageSummaryGeneratorModal
          docId={doc.doc_id}
          onClose={() => setOnePageSummaryOpen(false)}
        />
      )}

      {shapeVisibilityOpen && (
        <ShapeVisibilityAuditModal
          docId={doc.doc_id}
          onClose={() => setShapeVisibilityOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {icebreakerOpen && (
        <IcebreakerSlideGeneratorModal
          docId={doc.doc_id}
          onClose={() => setIcebreakerOpen(false)}
        />
      )}

      {bgColorOpen && (
        <SlideBackgroundColorModal
          docId={doc.doc_id}
          onClose={() => setBgColorOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {narrativeConsistOpen && (
        <NarrativeConsistencyCheckerModal
          docId={doc.doc_id}
          onClose={() => setNarrativeConsistOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {layerOrderOpen && (
        <SlideLayerOrderAuditModal
          docId={doc.doc_id}
          onClose={() => setLayerOrderOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {brandVoiceOpen && (
        <BrandVoiceScorerModal
          docId={doc.doc_id}
          onClose={() => setBrandVoiceOpen(false)}
        />
      )}

      {punctConsistOpen && (
        <PunctuationConsistencyCheckModal
          docId={doc.doc_id}
          onClose={() => setPunctConsistOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {splitRecommendOpen && (
        <SlideSplitRecommenderModal
          docId={doc.doc_id}
          onClose={() => setSplitRecommendOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {textDensityOpen && (
        <SlideTextDensityModal
          docId={doc.doc_id}
          onClose={() => setTextDensityOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {transitionOpen && (
        <SlideTransitionSuggesterModal
          docId={doc.doc_id}
          onClose={() => setTransitionOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {dupSlideOpen && (
        <DuplicateSlideContentModal
          docId={doc.doc_id}
          onClose={() => setDupSlideOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {ctaRaterOpen && (
        <CtaStrengthRaterModal
          docId={doc.doc_id}
          onClose={() => setCtaRaterOpen(false)}
        />
      )}

      {agendaDetectorOpen && (
        <AgendaSlideDetectorModal
          docId={doc.doc_id}
          onClose={() => setAgendaDetectorOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {passiveVoiceOpen && (
        <PassiveVoiceDetectorModal
          docId={doc.doc_id}
          onClose={() => setPassiveVoiceOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {slideLengthOpen && (
        <SlideLengthEstimatorModal
          docId={doc.doc_id}
          onClose={() => setSlideLengthOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {dataClaimOpen && (
        <DataClaimCheckerModal
          docId={doc.doc_id}
          onClose={() => setDataClaimOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {quoteFinderOpen && (
        <SlideQuoteFinderModal
          docId={doc.doc_id}
          onClose={() => setQuoteFinderOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {abbreviationOpen && (
        <AbbreviationFinderModal
          docId={doc.doc_id}
          onClose={() => setAbbreviationOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {moodAnalyzerOpen && (
        <PresentationMoodAnalyzerModal
          docId={doc.doc_id}
          onClose={() => setMoodAnalyzerOpen(false)}
        />
      )}

      {jargonFinderOpen && (
        <JargonFinderModal
          docId={doc.doc_id}
          onClose={() => setJargonFinderOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {titleSlideOpen && (
        <TitleSlideDetectorModal
          docId={doc.doc_id}
          onClose={() => setTitleSlideOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {questionSlideOpen && (
        <QuestionSlideFinderModal
          docId={doc.doc_id}
          onClose={() => setQuestionSlideOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {themeExtractorOpen && (
        <SlideThemeExtractorModal
          docId={doc.doc_id}
          onClose={() => setThemeExtractorOpen(false)}
        />
      )}

      {complexityScorerOpen && (
        <SlideComplexityScorerModal
          docId={doc.doc_id}
          onClose={() => setComplexityScorerOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {titleLengthOpen && (
        <SlideTitleLengthCheckerModal
          docId={doc.doc_id}
          onClose={() => setTitleLengthOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {testimonialOpen && (
        <TestimonialSlideFinderModal
          docId={doc.doc_id}
          onClose={() => setTestimonialOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {sentimentTrendOpen && (
        <SlideSentimentTrendModal
          docId={doc.doc_id}
          onClose={() => setSentimentTrendOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {colorCountOpen && (
        <ColorCountPerSlideModal
          docId={doc.doc_id}
          onClose={() => setColorCountOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {fontSizeAuditOpen && (
        <SlideFontSizeAuditModal
          docId={doc.doc_id}
          onClose={() => setFontSizeAuditOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {notesSummaryOpen && (
        <PresenterNotesSummarizerModal
          docId={doc.doc_id}
          onClose={() => setNotesSummaryOpen(false)}
        />
      )}

      {imageQualityOpen && (
        <SlideImageQualityCheckerModal
          docId={doc.doc_id}
          onClose={() => setImageQualityOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {freshnessOpen && (
        <ContentFreshnessCheckerModal
          docId={doc.doc_id}
          onClose={() => setFreshnessOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {tocGenOpen && (
        <SlideTocGeneratorModal
          docId={doc.doc_id}
          onClose={() => setTocGenOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {riskFinderOpen && (
        <RiskStatementFinderModal
          docId={doc.doc_id}
          onClose={() => setRiskFinderOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {visualMetaphorOpen && (
        <VisualMetaphorCheckerModal
          docId={doc.doc_id}
          onClose={() => setVisualMetaphorOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {actionPlanOpen && (
        <SlideActionPlanExtractorModal
          docId={doc.doc_id}
          onClose={() => setActionPlanOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {slideNumbersOpen && (
        <SlideNumbersModal
          docId={doc.doc_id}
          slideCount={localSlideCount}
          onClose={() => setSlideNumbersOpen(false)}
          onAdded={() => setRefreshKey((k) => k + 1)}
        />
      )}

      {aiScoreOpen && (
        <AIPresentationScoreModal
          docId={doc.doc_id}
          onClose={() => setAiScoreOpen(false)}
        />
      )}

      {agendaSlideOpen && (
        <AgendaSlideModal
          docId={doc.doc_id}
          slideCount={localSlideCount}
          currentSlide={selectedSlide}
          onClose={() => setAgendaSlideOpen(false)}
          onInserted={(newSlideN, newCount) => {
            handleSlideCountChange(newCount, newSlideN)
            setRefreshKey((k) => k + 1)
          }}
        />
      )}

      {notesReviewOpen && (
        <NotesReviewPanel
          docId={doc.doc_id}
          slideCount={localSlideCount}
          initialSlide={selectedSlide}
          refreshKey={refreshKey}
          onClose={() => setNotesReviewOpen(false)}
          onJumpToSlide={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
        />
      )}

      {presenting && (
        <PresentationMode
          docId={doc.doc_id}
          slideCount={localSlideCount}
          startSlide={selectedSlide}
          onClose={() => setPresenting(false)}
        />
      )}

      {slideSorterOpen && (
        <SlideSorterModal
          docId={doc.doc_id}
          slideCount={localSlideCount}
          selectedSlide={selectedSlide}
          onClose={() => setSlideSorterOpen(false)}
          onJump={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
          onSlideCountChange={handleSlideCountChange}
        />
      )}

      {outlineGenOpen && (
        <GenerateFromOutlineModal
          docId={doc.doc_id}
          onClose={() => setOutlineGenOpen(false)}
          onGenerated={(newCount) => {
            handleSlideCountChange(newCount, localSlideCount + 1)
            setRefreshKey((k) => k + 1)
          }}
        />
      )}

      {/* canvas right-click slide context menu */}
      {slideCtxMenu && (
        <>
          <div className="fixed inset-0 z-[99998]" onClick={() => setSlideCtxMenu(null)} onContextMenu={(e) => { e.preventDefault(); setSlideCtxMenu(null) }} />
          <div
            className="fixed z-[99999] bg-surface border border-edge rounded shadow-xl py-1 min-w-[180px] text-xs"
            style={{ left: slideCtxMenu.x, top: slideCtxMenu.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-0.5 text-[10px] text-muted uppercase tracking-wide border-b border-edge/50 mb-1">
              Slide {selectedSlide} / {localSlideCount}
            </div>
            {[
              { label: "Add slide after this", action: async () => { try { const r = await addSlide(doc.doc_id, selectedSlide); handleSlideCountChange(r.slide_count, r.new_slide_n ?? selectedSlide + 1); setRefreshKey((k) => k + 1) } catch { /* */ } } },
              { label: "Duplicate this slide", action: async () => { try { const r = await duplicateSlide(doc.doc_id, selectedSlide); handleSlideCountChange(r.slide_count, r.new_slide_n ?? selectedSlide + 1); setRefreshKey((k) => k + 1) } catch { /* */ } } },
              null,
              { label: pinnedSlides.has(selectedSlide) ? "Unpin slide" : "Pin slide (Ctrl+B)", action: () => { const isPinned = pinnedSlides.has(selectedSlide); pinSlide(doc.doc_id, selectedSlide, !isPinned).then(() => setPinnedSlides((prev) => { const next = new Set(prev); if (isPinned) next.delete(selectedSlide); else next.add(selectedSlide); return next })).catch(() => {}) } },
              null,
              { label: "Insert text box (Ctrl+T)", action: () => handleInsertShape("text_box") },
              { label: "Insert rectangle", action: () => handleInsertShape("rect") },
              { label: "Insert ellipse", action: () => handleInsertShape("ellipse") },
              null,
              { label: "Select all elements (Ctrl+A)", action: () => { /* handled by keyboard */ document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true })) } },
            ].map((item, i) =>
              item === null ? (
                <div key={i} className="border-t border-edge/50 my-1" />
              ) : (
                <button
                  key={i}
                  onClick={() => { item.action(); setSlideCtxMenu(null) }}
                  className="w-full text-left px-3 py-1.5 text-slate-300 hover:bg-white/10 transition-colors"
                >
                  {item.label}
                </button>
              )
            )}
          </div>
        </>
      )}
    </div>
  )
}
