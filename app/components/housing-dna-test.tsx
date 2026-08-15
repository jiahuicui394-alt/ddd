"use client";

import { useMemo, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { HOUSING_CALIBRATION_PROPERTIES } from "@/lib/housing-calibration";
import {
  applyHbtiPriorityOrder,
  DEFAULT_HBTI_ANSWERS,
  DEFAULT_HOUSING_DNA_ORDER,
  deriveHbtiProfile,
  HBTI_QUESTIONS,
} from "@/lib/housing-scoring";
import type {
  FiveGridValue,
  HbtiAnswers,
  HbtiQuestionId,
  HousingPreferenceKey,
  PreferenceProfile,
} from "@/lib/housing-scoring";
import { HBTI_QUESTION_COPY, PREFERENCE_LABELS, type Locale } from "@/lib/i18n";

type Props = {
  locale: Locale;
  hasSearchResults: boolean;
  onComplete: (profile: PreferenceProfile) => void;
  onRestart: () => void;
  onContinue: () => void;
};

const QUESTIONS_PER_PAGE = 5;
const SCALE_VALUES: FiveGridValue[] = [-2, -1, 0, 1, 2];

const TEXT = {
  zh: {
    intro: "用 20 个真实生活场景，找到你的住房行为类型。",
    independent: "HBTI 与通勤搜索相互独立，可以先完成任意一个。",
    question: "题目", answered: "已回答", page: "页", of: "/",
    disagree: "非常不同意", neutral: "中立", agree: "非常同意",
    previous: "← 上一页", next: "下一页 →", finish: "查看我的 HBTI →",
    answerAll: "请回答本页的 5 个问题后继续",
    result: "你的 HBTI", customize: "调整我的优先级",
    customizeHint: "按住 ☰ 上下拖动。调整后，现有候选房源会立即重新排名，不会重新计算通勤圈。",
    rankWeights: ["35%", "25%", "18%", "13%", "9%"],
    restart: "重新测试", view: "查看 Roomance 推荐 ↓", goSearch: "保存偏好，去搜索目的地 ↑",
    types: {
      commute: ["🚃 Time Saver", "你愿意用一些房租和空间，换取更短、更稳定的通勤。"],
      price: ["💰 Smart Saver", "你会认真控制每月固定支出，在可接受条件里寻找更高性价比。"],
      housing: ["🏠 Comfort Seeker", "你更重视每天回家后的空间与居住品质，愿意为舒适做取舍。"],
      station: ["🚉 Easy Access", "你希望每天从家到车站轻松直接，把步行摩擦降到最低。"],
      lifestyle: ["🌆 City Connector", "你希望住处能连接朋友、餐厅、购物和喜欢的城市生活。"],
    },
  },
  ja: {
    intro: "20の具体的な暮らしの場面から、住まい選びの行動タイプを見つけます。",
    independent: "HBTI と通勤検索は独立しており、どちらからでも始められます。",
    question: "質問", answered: "回答済み", page: "ページ", of: "/",
    disagree: "まったく同意しない", neutral: "中立", agree: "とても同意する",
    previous: "← 前へ", next: "次へ →", finish: "HBTI 結果を見る →",
    answerAll: "このページの5問すべてに回答してください",
    result: "あなたの HBTI", customize: "優先順位を調整",
    customizeHint: "☰ を押したまま上下にドラッグ。通勤圏を再計算せず、現在の候補だけをすぐ並べ替えます。",
    rankWeights: ["35%", "25%", "18%", "13%", "9%"],
    restart: "もう一度", view: "Roomance のおすすめを見る ↓", goSearch: "保存して目的地を検索 ↑",
    types: {
      commute: ["🚃 Time Saver", "家賃や広さを少し譲っても、短く安定した通勤を選ぶタイプです。"],
      price: ["💰 Smart Saver", "毎月の固定費を丁寧に抑え、条件とのバランスが良い部屋を探します。"],
      housing: ["🏠 Comfort Seeker", "帰宅後の広さや住み心地を重視し、快適さのために調整できます。"],
      station: ["🚉 Easy Access", "駅までの移動を軽くして、毎日の小さな負担を減らしたいタイプです。"],
      lifestyle: ["🌆 City Connector", "友人、飲食店、買い物など好きな街とのつながりを大切にします。"],
    },
  },
  en: {
    intro: "Discover your housing behavior through 20 concrete, everyday trade-offs.",
    independent: "HBTI and commute search are independent — start with either one.",
    question: "Question", answered: "answered", page: "Page", of: "/",
    disagree: "Strongly disagree", neutral: "Neutral", agree: "Strongly agree",
    previous: "← Previous", next: "Next →", finish: "See my HBTI →",
    answerAll: "Answer all five questions on this page to continue",
    result: "Your HBTI", customize: "Customize My Priorities",
    customizeHint: "Hold ☰ and drag vertically. Existing candidates re-rank instantly without calling TravelTime again.",
    rankWeights: ["35%", "25%", "18%", "13%", "9%"],
    restart: "Retake", view: "View Roomance matches ↓", goSearch: "Save and search a destination ↑",
    types: {
      commute: ["🚃 Time Saver", "You trade some rent and space for a shorter, more reliable commute."],
      price: ["💰 Smart Saver", "You protect your monthly budget and look for the strongest value among acceptable homes."],
      housing: ["🏠 Comfort Seeker", "You prioritize space and everyday comfort, and will trade for a better home."],
      station: ["🚉 Easy Access", "You minimize the daily friction between your front door and the station."],
      lifestyle: ["🌆 City Connector", "You value easy access to friends, dining, shopping and the city life you enjoy."],
    },
  },
} as const;

function primaryDimension(profile: PreferenceProfile): HousingPreferenceKey {
  return (Object.keys(profile.weights) as HousingPreferenceKey[])
    .sort((left, right) => profile.weights[right] - profile.weights[left])[0];
}

function displayPercentages(profile: PreferenceProfile) {
  const values = Object.fromEntries(
    Object.entries(profile.weights).map(([key, value]) => [key, Math.round(value * 100)]),
  ) as Record<HousingPreferenceKey, number>;
  const difference = 100 - Object.values(values).reduce((sum, value) => sum + value, 0);
  values[primaryDimension(profile)] += difference;
  return values;
}

export default function HousingDnaTest({ locale, hasSearchResults, onComplete, onRestart, onContinue }: Props) {
  const text = TEXT[locale];
  const [pageIndex, setPageIndex] = useState(0);
  const [answers, setAnswers] = useState<HbtiAnswers>({ ...DEFAULT_HBTI_ANSWERS });
  const [answeredIds, setAnsweredIds] = useState<Set<HbtiQuestionId>>(() => new Set());
  const [profile, setProfile] = useState<PreferenceProfile | null>(null);
  const [priorityOrder, setPriorityOrder] = useState<HousingPreferenceKey[]>([...DEFAULT_HOUSING_DNA_ORDER]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const pageQuestions = useMemo(
    () => HBTI_QUESTIONS.slice(pageIndex * QUESTIONS_PER_PAGE, (pageIndex + 1) * QUESTIONS_PER_PAGE),
    [pageIndex],
  );
  const pageComplete = pageQuestions.every((question) => answeredIds.has(question.id));
  const progress = Math.round((answeredIds.size / HBTI_QUESTIONS.length) * 100);

  function answerQuestion(id: HbtiQuestionId, value: FiveGridValue) {
    setAnswers((current) => ({ ...current, [id]: value }));
    setAnsweredIds((current) => new Set(current).add(id));
  }

  function finishTest() {
    const nextProfile = deriveHbtiProfile(answers, HOUSING_CALIBRATION_PROPERTIES);
    const nextOrder = (Object.keys(nextProfile.weights) as HousingPreferenceKey[])
      .sort((left, right) => nextProfile.weights[right] - nextProfile.weights[left]);
    setPriorityOrder(nextOrder);
    setProfile(nextProfile);
    onComplete(nextProfile);
  }

  function movePriority(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    setPriorityOrder((current) => {
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      setDragIndex(toIndex);
      if (profile) {
        const customized = applyHbtiPriorityOrder(profile, next);
        setProfile(customized);
        onComplete(customized);
      }
      return next;
    });
  }

  function handlePriorityMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (dragIndex == null) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-priority-index]");
    const targetIndex = target ? Number(target.dataset.priorityIndex) : Number.NaN;
    if (Number.isInteger(targetIndex) && targetIndex !== dragIndex) movePriority(dragIndex, targetIndex);
  }

  function restart() {
    setPageIndex(0);
    setAnswers({ ...DEFAULT_HBTI_ANSWERS });
    setAnsweredIds(new Set());
    setProfile(null);
    setPriorityOrder([...DEFAULT_HOUSING_DNA_ORDER]);
    setDragIndex(null);
    onRestart();
  }

  if (profile) {
    const primary = primaryDimension(profile);
    const type = text.types[primary];
    const percentages = displayPercentages(profile);
    return (
      <section className="housing-dna standalone-dna hbti-test" id="housing-dna">
        <div className="dna-result hbti-result applied">
          <span className="dna-result-label">{text.result}</span>
          <h4>{type[0]}</h4>
          <p>{type[1]}</p>
          <div className="hbti-weight-list" aria-label="HBTI weights">
            {priorityOrder.map((key) => (
              <div key={key}>
                <span>{PREFERENCE_LABELS[locale][key]}</span>
                <i><b style={{ width: `${percentages[key]}%` }} /></i>
                <strong>{percentages[key]}%</strong>
              </div>
            ))}
          </div>
          <div className="priority-customizer">
            <div className="priority-customizer-heading">
              <strong>{text.customize}</strong>
              <small>{text.customizeHint}</small>
            </div>
            <div className="priority-sort-list">
              {priorityOrder.map((key, index) => (
                <div
                  className={`priority-sort-row ${dragIndex === index ? "dragging" : ""}`}
                  data-priority-index={index}
                  key={key}
                >
                  <button
                    type="button"
                    className="priority-drag-handle"
                    aria-label={`${PREFERENCE_LABELS[locale][key]} drag handle`}
                    onPointerDown={(event) => {
                      event.currentTarget.setPointerCapture(event.pointerId);
                      setDragIndex(index);
                    }}
                    onPointerMove={handlePriorityMove}
                    onPointerUp={(event) => {
                      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                      setDragIndex(null);
                    }}
                    onPointerCancel={() => setDragIndex(null)}
                  >☰</button>
                  <span>{index + 1}</span>
                  <strong>{PREFERENCE_LABELS[locale][key]}</strong>
                  <em>{text.rankWeights[index]}</em>
                </div>
              ))}
            </div>
          </div>
          <div className="dna-actions">
            <button type="button" className="secondary-dna" onClick={restart}>{text.restart}</button>
            <button type="button" className="apply-dna" onClick={onContinue}>{hasSearchResults ? text.view : text.goSearch}</button>
          </div>
        </div>
      </section>
    );
  }

  const firstQuestion = pageIndex * QUESTIONS_PER_PAGE + 1;
  const lastQuestion = firstQuestion + pageQuestions.length - 1;

  return (
    <section className="housing-dna standalone-dna hbti-test" id="housing-dna">
      <div className="hbti-heading">
        <div><span>HBTI</span><h3>Housing Behavior Type Indicator</h3><p>{text.intro}</p></div>
        <small>{text.independent}</small>
      </div>
      <div className="hbti-progress-copy">
        <strong>{text.question} {firstQuestion}–{lastQuestion} {text.of} {HBTI_QUESTIONS.length}</strong>
        <span>{text.answered} {answeredIds.size} · {progress}%</span>
      </div>
      <div className="hbti-progress" aria-label={`${progress}%`}><i style={{ width: `${progress}%` }} /></div>
      <div className="hbti-question-list">
        {pageQuestions.map((question, pageQuestionIndex) => {
          const questionNumber = firstQuestion + pageQuestionIndex;
          return (
            <article className={`hbti-question ${answeredIds.has(question.id) ? "answered" : ""}`} key={question.id}>
              <span>{String(questionNumber).padStart(2, "0")}</span>
              <h4>{HBTI_QUESTION_COPY[locale][question.id]}</h4>
              <div className="hbti-scale-labels"><small>{text.disagree}</small><small>{text.neutral}</small><small>{text.agree}</small></div>
              <div className="hbti-scale" role="radiogroup" aria-label={`${text.question} ${questionNumber}`}>
                {SCALE_VALUES.map((value) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={answeredIds.has(question.id) && answers[question.id] === value}
                    aria-label={value === -2 ? text.disagree : value === 0 ? text.neutral : value === 2 ? text.agree : `${value}`}
                    className={answeredIds.has(question.id) && answers[question.id] === value ? "active" : ""}
                    onClick={() => answerQuestion(question.id, value)}
                    key={value}
                  ><i /></button>
                ))}
              </div>
            </article>
          );
        })}
      </div>
      {!pageComplete && <p className="hbti-page-hint">{text.answerAll}</p>}
      <div className="dna-actions hbti-actions">
        <button type="button" className="secondary-dna" disabled={pageIndex === 0} onClick={() => setPageIndex((current) => Math.max(0, current - 1))}>{text.previous}</button>
        <span>{text.page} {pageIndex + 1} {text.of} {Math.ceil(HBTI_QUESTIONS.length / QUESTIONS_PER_PAGE)}</span>
        <button
          type="button"
          className="apply-dna"
          disabled={!pageComplete}
          onClick={() => pageIndex === 3 ? finishTest() : setPageIndex((current) => current + 1)}
        >{pageIndex === 3 ? text.finish : text.next}</button>
      </div>
    </section>
  );
}
