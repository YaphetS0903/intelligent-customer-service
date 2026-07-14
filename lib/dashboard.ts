import {
  getCurrentUser,
  countAllMessages,
  listAllConversations,
  listDocuments,
  listFeedback,
  listKnowledgeBases,
  listTrainingJobs
} from "@/lib/db";

export type DashboardStats = {
  totals: {
    knowledgeBases: number;
    documents: number;
    readyDocuments: number;
    trainingJobs: number;
    conversations: number;
    messages: number;
    feedback: number;
    likes: number;
    dislikes: number;
  };
  rates: {
    documentReadyRate: number;
    satisfactionRate: number;
  };
  recent: {
    documents: Array<{ id: string; title: string; status: string; created_at: string }>;
    trainingJobs: Array<{ id: string; title: string; status: string; created_at: string }>;
    conversations: Array<{ id: string; title: string; updated_at: string }>;
    feedback: Array<{ id: string; rating: string; comment: string | null; created_at: string }>;
  };
};

const emptyDashboardStats: DashboardStats = {
  totals: {
    knowledgeBases: 0,
    documents: 0,
    readyDocuments: 0,
    trainingJobs: 0,
    conversations: 0,
    messages: 0,
    feedback: 0,
    likes: 0,
    dislikes: 0
  },
  rates: {
    documentReadyRate: 0,
    satisfactionRate: 0
  },
  recent: {
    documents: [],
    trainingJobs: [],
    conversations: [],
    feedback: []
  }
};

export async function getDashboardStats(): Promise<DashboardStats> {
  const user = await withTimeout(getCurrentUser(), null, 2000);

  if (!user) {
    return emptyDashboardStats;
  }

  const [knowledgeBases, documents, trainingJobs, allConversations, feedback, messageCount] = await Promise.all([
    withTimeout(listKnowledgeBases(), [], 1200),
    withTimeout(listDocuments(), [], 1200),
    withTimeout(listTrainingJobs(), [], 1200),
    withTimeout(listAllConversations(), [], 1200),
    withTimeout(listFeedback(), [], 1200),
    withTimeout(countAllMessages(), 0, 1200)
  ]);

  const conversations =
    user.role === "admin"
      ? allConversations
      : allConversations.filter((conversation) => conversation.user_id === user.id);

  const readyDocuments = documents.filter((document) => document.status === "ready").length;
  const likes = feedback.filter((item) => item.rating === "like").length;
  const dislikes = feedback.filter((item) => item.rating === "dislike").length;

  return {
    totals: {
      knowledgeBases: knowledgeBases.length,
      documents: documents.length,
      readyDocuments,
      trainingJobs: trainingJobs.length,
      conversations: conversations.length,
      messages: messageCount,
      feedback: feedback.length,
      likes,
      dislikes
    },
    rates: {
      documentReadyRate: percent(readyDocuments, documents.length),
      satisfactionRate: percent(likes, likes + dislikes)
    },
    recent: {
      documents: documents.slice(0, 5).map((document) => ({
        id: document.id,
        title: document.title,
        status: document.status,
        created_at: document.created_at
      })),
      trainingJobs: trainingJobs.slice(0, 5).map((job) => ({
        id: job.id,
        title: job.title,
        status: job.status,
        created_at: job.created_at
      })),
      conversations: conversations.slice(0, 5).map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        updated_at: conversation.updated_at
      })),
      feedback: feedback.slice(0, 5).map((item) => ({
        id: item.id,
        rating: item.rating,
        comment: item.comment,
        created_at: item.created_at
      }))
    }
  };
}

function percent(value: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Math.round((value / total) * 100);
}

async function withTimeout<T>(promise: Promise<T>, fallback: T, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => resolve(fallback), timeoutMs);
      })
    ]);
  } catch {
    return fallback;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
