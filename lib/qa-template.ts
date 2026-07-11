export type QaTemplateItem = {
  question: string;
  expected_answer: string;
  category: "安全" | "质量" | "生产" | "设备" | "培训" | "人事行政";
};

export const pilotQaTemplate: QaTemplateItem[] = [
  {
    category: "安全",
    question: "员工进入生产车间前需要佩戴哪些劳保用品？",
    expected_answer: "应说明进入车间需要按制度佩戴安全帽、防护眼镜、手套、防护鞋等劳保用品，并以公司安全培训资料为准。"
  },
  {
    category: "安全",
    question: "发现消防通道被物料占用时应该怎么处理？",
    expected_answer: "应立即清理或上报班组长/EHS，保持消防通道和安全出口畅通。"
  },
  {
    category: "安全",
    question: "发生轻微工伤或安全隐患时员工需要向谁报告？",
    expected_answer: "应及时向班组长、部门负责人或安全/EHS 负责人报告，并按公司流程记录处理。"
  },
  {
    category: "安全",
    question: "新员工上岗前需要完成哪些安全培训？",
    expected_answer: "应回答新员工需完成入职安全教育、岗位安全操作规程、应急处置等培训，通过要求后再上岗。"
  },
  {
    category: "安全",
    question: "操作设备时能否佩戴首饰或违规穿戴？",
    expected_answer: "应说明不得佩戴可能卷入设备的首饰、围巾等物品，应按岗位要求规范穿戴。"
  },
  {
    category: "质量",
    question: "首件检验未确认前可以批量生产吗？",
    expected_answer: "应说明首件检验或首件确认未通过前不得批量生产，需按质量流程确认后再生产。"
  },
  {
    category: "质量",
    question: "发现产品外观缺陷时应该如何处理？",
    expected_answer: "应说明应隔离不合格品、标识问题、通知质检或班组长，并按不合格品流程处理。"
  },
  {
    category: "质量",
    question: "质量检验记录通常需要保存多久？",
    expected_answer: "应依据公司资料回答保存期限；如果资料未明确，应提示未找到明确依据。"
  },
  {
    category: "质量",
    question: "生产过程中发现尺寸异常时下一步应该做什么？",
    expected_answer: "应停止或暂停相关批次、隔离产品、通知质量和生产负责人，并按异常处理流程确认。"
  },
  {
    category: "质量",
    question: "不合格品可以直接返工或放行吗？",
    expected_answer: "应说明不合格品需按流程评审、隔离、标识，未经授权不得擅自返工或放行。"
  },
  {
    category: "生产",
    question: "班前会通常需要确认哪些内容？",
    expected_answer: "应回答安全提醒、生产计划、质量要求、设备状态、人员安排和异常事项等。"
  },
  {
    category: "生产",
    question: "生产线换型或切换产品时需要注意什么？",
    expected_answer: "应说明需确认工艺参数、模具/工装、物料、首件确认和现场清理等。"
  },
  {
    category: "生产",
    question: "物料标识不清或批次不明确时可以继续使用吗？",
    expected_answer: "应说明不得随意使用，应暂停并向仓储、质量或班组长确认。"
  },
  {
    category: "生产",
    question: "员工发现生产计划和现场实际不一致时应该怎么办？",
    expected_answer: "应向班组长或计划相关人员确认，不得自行改变生产安排。"
  },
  {
    category: "生产",
    question: "现场 5S 管理通常包括哪些要求？",
    expected_answer: "应回答整理、整顿、清扫、清洁、素养等要求，并结合现场定置和清洁维护。"
  },
  {
    category: "设备",
    question: "设备开机前需要做哪些点检？",
    expected_answer: "应说明按设备点检表检查安全防护、润滑、气压/电源、异常声音、工装状态等。"
  },
  {
    category: "设备",
    question: "设备运行中出现异常声音或报警时应该怎么处理？",
    expected_answer: "应立即按安全要求停机或暂停操作，通知班组长和设备维修人员，不得带病运行。"
  },
  {
    category: "设备",
    question: "设备点检表漏填后应该如何补救？",
    expected_answer: "应如实补充记录并向班组长说明，不得伪造记录；具体按公司点检制度执行。"
  },
  {
    category: "设备",
    question: "非维修人员可以自行拆卸设备防护装置吗？",
    expected_answer: "应说明不得擅自拆卸或屏蔽安全防护装置，需由授权人员处理。"
  },
  {
    category: "设备",
    question: "设备保养完成后恢复生产前需要确认什么？",
    expected_answer: "应确认设备状态、安全防护、参数、现场清理和首件/试运行结果。"
  },
  {
    category: "培训",
    question: "新员工试用期通常需要学习哪些公司制度？",
    expected_answer: "应回答安全、质量、考勤、岗位操作、员工行为规范等制度，并引用培训资料。"
  },
  {
    category: "培训",
    question: "培训完成后员工需要如何确认学习结果？",
    expected_answer: "应根据资料说明签到、考试、实操确认、主管评价或学习记录等要求。"
  },
  {
    category: "培训",
    question: "岗位变更后是否需要重新培训？",
    expected_answer: "应说明岗位变更、工艺变化或设备变化后通常需要重新进行岗位相关培训。"
  },
  {
    category: "培训",
    question: "员工未通过培训考核可以直接上岗吗？",
    expected_answer: "应说明未通过必要培训或考核前不应独立上岗，需要补训或复核。"
  },
  {
    category: "培训",
    question: "PPT 培训资料生成语音讲解后员工在哪里查看？",
    expected_answer: "应说明可在培训讲解入口查看课程，并按页面播放逐页讲稿和语音。"
  },
  {
    category: "人事行政",
    question: "员工请假通常需要提前提交哪些信息？",
    expected_answer: "应说明请假类型、时间、原因、审批人等，具体按公司考勤或请假制度执行。"
  },
  {
    category: "人事行政",
    question: "迟到、早退或漏打卡应该如何处理？",
    expected_answer: "应根据公司考勤制度说明补卡、说明原因、审批流程和记录要求。"
  },
  {
    category: "人事行政",
    question: "员工报销费用时需要准备哪些材料？",
    expected_answer: "应说明发票、审批单、费用说明、相关凭证等，具体以公司报销制度为准。"
  },
  {
    category: "人事行政",
    question: "员工信息或联系方式变更后需要通知谁？",
    expected_answer: "应说明应及时通知人事/行政或直属主管，更新员工档案。"
  },
  {
    category: "人事行政",
    question: "员工对制度回答有疑问或发现答案不准确时应该怎么反馈？",
    expected_answer: "应说明可在智能客服答案处点赞/点踩或填写反馈，管理员会在后台处理。"
  }
];
