import { isLocalTextRag } from "@/lib/config";
import {
  createDocument,
  createDocumentChunks,
  createDocumentVersion,
  createKnowledgeBase,
  createKnowledgeTask,
  createQaTestCase,
  createTrainingJob,
  listDocuments,
  listKnowledgeBases,
  listKnowledgeTasks,
  listQaTestCases,
  listTrainingJobs
} from "@/lib/db";
import { chunkExtractedText, type ExtractedText } from "@/lib/document-text";

export type DemoSeedResult = {
  knowledgeBaseId: string;
  created: {
    knowledgeBases: number;
    documents: number;
    chunks: number;
    qaTests: number;
    knowledgeTasks: number;
    trainingJobs: number;
  };
  skipped: string[];
};

const demoKnowledgeBaseName = "员工培训手册";
const demoDocumentTitle = "演示资料-员工安全与生产制度";
const demoTrainingTitle = "演示课程-车间安全与质量培训";

const demoQaTests = [
  {
    question: "员工进入生产车间前需要佩戴哪些劳保用品？",
    expected_answer: "应说明进入车间需要按岗位要求佩戴安全帽、防护鞋、工作服等劳保用品，特殊岗位还要佩戴耳塞、防尘口罩、防护眼镜或防护手套。"
  },
  {
    question: "消防通道周边可以堆放物料吗？",
    expected_answer: "不得堆放物料、周转箱、工具车或杂物，消防通道、安全出口和消防设施周边必须保持畅通。"
  },
  {
    question: "发现消防通道被占用时应该怎么处理？",
    expected_answer: "应立即提醒现场责任人清理，并向班组长或安全管理人员报告，整改完成前不得继续占用。"
  },
  {
    question: "设备异常时员工应该怎么做？",
    expected_answer: "应立即停止操作，保留现场，通知班组长和设备维修人员，未经确认不得擅自继续生产。"
  },
  {
    question: "首件未经确认可以批量生产吗？",
    expected_answer: "不得批量生产，必须完成首件确认并由质量或工艺人员确认后才能继续生产。"
  },
  {
    question: "发现质量异常应该如何反馈？",
    expected_answer: "应立即隔离异常品，标识状态，通知班组长和质量人员，并按流程记录异常信息。"
  }
];

export async function seedDemoData(createdBy: string): Promise<DemoSeedResult> {
  const created = {
    knowledgeBases: 0,
    documents: 0,
    chunks: 0,
    qaTests: 0,
    knowledgeTasks: 0,
    trainingJobs: 0
  };
  const skipped: string[] = [];
  const knowledgeBase = await ensureDemoKnowledgeBase();
  created.knowledgeBases = knowledgeBase.created ? 1 : 0;

  if (!knowledgeBase.created) {
    skipped.push("知识库已存在");
  }

  const documentResult = await ensureDemoDocument(knowledgeBase.item.id, createdBy);
  created.documents = documentResult.created ? 1 : 0;
  created.chunks = documentResult.chunks;

  if (!documentResult.created) {
    skipped.push("演示资料已存在");
  }

  const qaResult = await ensureDemoQaTests(knowledgeBase.item.id, createdBy);
  created.qaTests = qaResult.created;
  skipped.push(...qaResult.skipped);

  const taskResult = await ensureDemoKnowledgeTask(createdBy);
  created.knowledgeTasks = taskResult.created ? 1 : 0;

  if (!taskResult.created) {
    skipped.push("演示整改任务已存在");
  }

  const trainingResult = await ensureDemoTrainingJob(createdBy);
  created.trainingJobs = trainingResult.created ? 1 : 0;

  if (!trainingResult.created) {
    skipped.push("演示培训课程已存在");
  }

  return {
    knowledgeBaseId: knowledgeBase.item.id,
    created,
    skipped
  };
}

async function ensureDemoKnowledgeBase() {
  const existing = (await listKnowledgeBases()).find((kb) => kb.name === demoKnowledgeBaseName);

  if (existing) {
    return { item: existing, created: false };
  }

  const item = await createKnowledgeBase({
    name: demoKnowledgeBaseName,
    description: "演示用员工培训、车间安全、质量流程和常见制度知识库。",
    openai_vector_store_id: null,
    visibility: "all",
    departments: [],
    positions: []
  });

  return { item, created: true };
}

async function ensureDemoDocument(knowledgeBaseId: string, createdBy: string) {
  const existing = (await listDocuments()).find((document) =>
    document.knowledge_base_id === knowledgeBaseId && document.title === demoDocumentTitle
  );

  if (existing) {
    return { created: false, chunks: 0 };
  }

  const document = await createDocument({
    knowledge_base_id: knowledgeBaseId,
    title: demoDocumentTitle,
    file_name: `${demoDocumentTitle}.md`,
    file_type: "text/markdown",
    storage_path: null,
    openai_file_id: null,
    status: "ready",
    department: null,
    tags: ["演示数据", "安全培训", "质量流程"],
    created_by: createdBy
  });
  const extracted: ExtractedText = {
    title: demoDocumentTitle,
    content: demoKnowledgeMarkdown,
    sections: [
      {
        title: demoDocumentTitle,
        content: demoKnowledgeMarkdown,
        section: "演示知识资料",
        parser: "manual_supplement"
      }
    ]
  };
  const chunks = isLocalTextRag()
    ? chunkExtractedText({
        documentId: document.id,
        knowledgeBaseId,
        fileName: document.file_name,
        title: document.title,
        extracted
      })
    : [];

  const createdChunks = chunks.length > 0 ? await createDocumentChunks(chunks) : [];

  await createDocumentVersion({
    document_id: document.id,
    knowledge_base_id: knowledgeBaseId,
    title: document.title,
    file_name: document.file_name,
    file_type: document.file_type,
    status: document.status,
    change_note: "一键整理演示数据生成",
    created_by: createdBy,
    snapshot_chunks: createdChunks
  });

  return { created: true, chunks: chunks.length };
}

async function ensureDemoQaTests(knowledgeBaseId: string, createdBy: string) {
  const existingQuestions = new Set((await listQaTestCases()).map((test) => test.question));
  let created = 0;
  const skipped: string[] = [];

  for (const item of demoQaTests) {
    if (existingQuestions.has(item.question)) {
      skipped.push(`QA 已存在：${item.question}`);
      continue;
    }

    await createQaTestCase({
      question: item.question,
      expected_answer: item.expected_answer,
      knowledge_base_ids: [knowledgeBaseId],
      created_by: createdBy
    });
    created += 1;
  }

  return { created, skipped };
}

async function ensureDemoKnowledgeTask(createdBy: string) {
  const sourceId = "demo:quality-abnormal-flow";
  const existing = (await listKnowledgeTasks()).find((task) => task.source === "manual" && task.source_id === sourceId);

  if (existing) {
    return { created: false };
  }

  await createKnowledgeTask({
    source: "manual",
    source_id: sourceId,
    conversation_id: "demo-quality-flow",
    question: "发现质量异常应该如何反馈？",
    answer: "当前演示任务用于展示知识整改闭环：员工发现异常后需要隔离、标识、反馈和记录。",
    status: "processing",
    note: [
      "来源：演示数据",
      "原因：用于演示“会话反馈 -> 知识整改 -> 补充资料 -> 自动复测”的运营闭环。",
      "建议：补充质量异常处理 FAQ 后点击自动复测。"
    ].join("\n"),
    created_by: createdBy
  });

  return { created: true };
}

async function ensureDemoTrainingJob(createdBy: string) {
  const existing = (await listTrainingJobs()).find((job) => job.title === demoTrainingTitle);

  if (existing) {
    return { created: false };
  }

  await createTrainingJob({
    title: demoTrainingTitle,
    description: "面向车间员工的安全与质量基础培训。",
    instructor: "安全质量部",
    cover_url: null,
    visible_departments: [],
    ppt_file_name: "车间安全与质量培训-演示.pptx",
    ppt_storage_path: null,
    script_json: [
      {
        page: 1,
        title: "进入车间前的安全准备",
        bullets: ["佩戴岗位要求的劳保用品", "确认消防通道和安全出口畅通", "遵守现场安全标识"],
        notes: "用于演示 PPT 自动讲稿和语音播放流程。",
        script: "这一页我们讲进入车间前的安全准备。员工进入生产区域前，要按岗位要求佩戴劳保用品，确认消防通道、安全出口和消防设施周边保持畅通，并遵守现场安全标识。"
      },
      {
        page: 2,
        title: "设备异常处理",
        bullets: ["立即停止操作", "保留现场并通知班组长", "未经确认不得继续生产"],
        notes: "",
        script: "这一页说明设备异常处理。发现设备异常时，员工应立即停止操作，保留现场，通知班组长和设备维修人员。未经确认，不得擅自继续生产。"
      },
      {
        page: 3,
        title: "质量异常反馈",
        bullets: ["隔离异常品", "标识状态", "通知质量人员并记录"],
        notes: "",
        script: "最后一页是质量异常反馈。发现质量异常时，应立即隔离异常品，做好状态标识，通知班组长和质量人员，并按流程记录异常信息。"
      }
    ],
    audio_paths: [],
    status: "ready",
    publish_status: "published",
    published_by: createdBy,
    published_at: new Date().toISOString(),
    created_by: createdBy
  });

  return { created: true };
}

const demoKnowledgeMarkdown = `# 员工安全与生产制度演示资料

## 进入车间劳保要求
员工进入生产车间前必须按岗位要求佩戴安全帽、防护鞋、工作服等劳保用品。涉及噪声、粉尘、切割、冲压、喷胶等岗位时，还应按现场标识佩戴耳塞、防尘口罩、防护眼镜或防护手套。未按要求佩戴劳保用品不得进入对应作业区域。

## 消防通道管理
消防通道、安全出口和消防设施周边必须保持畅通，严禁堆放物料、周转箱、工具车或其他杂物。发现消防通道被占用时，员工应立即提醒现场责任人清理，并向班组长或安全管理人员报告。整改完成前不得继续占用消防通道。

## 设备异常处理
员工操作设备时，如发现异响、异味、卡滞、漏油、报警或安全防护装置异常，应立即停止操作，保留现场，通知班组长和设备维修人员。未经确认不得擅自继续生产，不得私自拆卸安全防护装置。

## 首件确认
生产换型、换模、换料、设备维修后恢复生产，必须进行首件确认。首件未经质量或工艺人员确认，不得批量生产。首件确认记录应完整保存，作为后续质量追溯依据。

## 质量异常反馈
发现尺寸、外观、装配、气味、污染、混料等质量异常时，应立即隔离异常品，标识状态，通知班组长和质量人员，并按流程记录异常信息。异常未关闭前，不得将可疑产品流入下一工序。
`;
