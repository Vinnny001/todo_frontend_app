import { useEffect, useState, useRef, useCallback } from "react";
import axios from "axios";
import { Network } from "@capacitor/network";
import {
  LocalNotifications,
  type PermissionStatus,
} from "@capacitor/local-notifications";

// ─── Types ────────────────────────────────────────────────────────────────────

type Subtask = { id: number; task: string; completed: boolean };
type Reminder = {
  id: number;
  daysBefore: number;
  message: string | null;
  enabled: boolean;
};
type Todo = {
  id: number;
  task: string;
  completed: boolean;
  dueDate: string | null;
  categoryId: number;
  subtasks: Subtask[];
  reminders: Reminder[];
  favourited: boolean;
  updatedAt?: string;
};
type Category = {
  id: number;
  name: string;
  color: string;
  locked?: boolean;
  updatedAt?: string;
};
type AppSettings = {
  notifyDueTodayEnabled: boolean;
  defaultReminderMessage: string;
};
type MenuItem = {
  label: string;
  icon: string;
  danger?: boolean;
  onClick: () => void;
};

// ─── Offline queue types ───────────────────────────────────────────────────────

type TodoChanges = Partial<{
  task: string;
  completed: boolean;
  dueDate: string | null;
  categoryId: number;
  favourited: boolean;
}>;
type CatChanges = Partial<{ name: string; color: string }>;

type QueueAction =
  | {
      id: string;
      kind: "createTodo";
      tempId: number;
      task: string;
      dueDate: string | null;
      categoryId: number;
    }
  | {
      id: string;
      kind: "updateTodo";
      todoId: number;
      changes: TodoChanges;
      expectedUpdatedAt: string | null;
    }
  | { id: string; kind: "deleteTodo"; todoId: number }
  | {
      id: string;
      kind: "createCategory";
      tempId: number;
      name: string;
      color: string;
    }
  | {
      id: string;
      kind: "updateCategory";
      catId: number;
      changes: CatChanges;
      expectedUpdatedAt: string | null;
    }
  | { id: string; kind: "deleteCategoryMove"; catId: number }
  | { id: string; kind: "deleteCategoryWithTasks"; catId: number };

type Conflict = {
  id: string;
  type: "todo" | "category";
  entityId: number;
  local: Todo | Category;
  server: Todo | Category;
  changes: TodoChanges | CatChanges;
};

// ─── Offline storage helpers ───────────────────────────────────────────────────

const LS_TODOS = "todo_cache_todos";
const LS_CATS = "todo_cache_categories";
const LS_QUEUE = "todo_mutation_queue";
const LS_CONFLICTS = "todo_conflicts";

function loadLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function saveLS(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable — offline cache simply won't persist across restarts
  }
}

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// ─── Local notification scheduling ─────────────────────────────────────────────

async function scheduleAllReminders(todos: Todo[], settings: AppSettings) {
  try {
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length) {
      await LocalNotifications.cancel({
        notifications: pending.notifications.map((n) => ({ id: n.id })),
      });
    }
  } catch {
    return; // not running under a native Capacitor shell — nothing to schedule
  }

  const now = Date.now();
  const toSchedule: {
    id: number;
    title: string;
    body: string;
    schedule: { at: Date };
  }[] = [];

  for (const todo of todos) {
    if (todo.completed || !todo.dueDate || todo.id < 0) continue;

    const due = new Date(todo.dueDate);

    for (const r of todo.reminders) {
      if (!r.enabled) continue;

      const notifyAt = new Date(due);
      notifyAt.setDate(notifyAt.getDate() - r.daysBefore);
      notifyAt.setHours(9, 0, 0, 0);
      if (notifyAt.getTime() <= now) continue;

      const template =
        r.message || settings.defaultReminderMessage || 'Task "{task}" is due today!';

      toSchedule.push({
        id: r.id,
        title:
          r.daysBefore === 0
            ? "Task due today"
            : `Task due in ${r.daysBefore} day${r.daysBefore === 1 ? "" : "s"}`,
        body: template.replace("{task}", todo.task),
        schedule: { at: notifyAt },
      });
    }
  }

  if (toSchedule.length) {
    try {
      await LocalNotifications.schedule({ notifications: toSchedule });
    } catch {
      // scheduling failed — nothing actionable client-side
    }
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const API = "https://crud-todo-api-776p.onrender.com";
const FAVOURITE_ID = 2;
const PRESET_COLORS = [
  "#6366f1",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#3b82f6",
  "#ec4899",
  "#8b5cf6",
  "#14b8a6",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      })
    : "";
const overdue = (iso: string | null) =>
  !!iso && new Date(iso) < new Date(new Date().toDateString());
const trunc = (s: string, n = 26) => (s.length > n ? s.slice(0, n) + "…" : s);

// ─── ColorDot ─────────────────────────────────────────────────────────────────

function ColorDot({ color, size = 9 }: { color: string; size?: number }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
      }}
    />
  );
}

// ─── ContextMenu ──────────────────────────────────────────────────────────────

function ContextMenu({
  items,
  onClose,
  anchorRef,
}: {
  items: MenuItem[];
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (
        ref.current &&
        !ref.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      )
        onClose();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose, anchorRef]);

  return (
    <div className="ctx-menu" ref={ref}>
      {items.map((item) => (
        <button
          key={item.label}
          className={`ctx-item${item.danger ? " danger" : ""}`}
          onClick={() => {
            item.onClick();
            onClose();
          }}
        >
          <span className="ctx-icon">{item.icon}</span>
          {item.label}
        </button>
      ))}
    </div>
  );
}

// ─── StarButton ───────────────────────────────────────────────────────────────

function StarButton({
  favourited,
  onClick,
}: {
  favourited: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      className={`star-btn${favourited ? " starred" : ""}`}
      onClick={onClick}
      title={favourited ? "Remove from Favourites" : "Add to Favourites"}
    >
      {favourited ? "★" : "☆"}
    </button>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [todos, setTodos] = useState<Todo[]>(() =>
    loadLS<Todo[]>(LS_TODOS, []),
  );
  const [categories, setCategories] = useState<Category[]>(() =>
    loadLS<Category[]>(LS_CATS, []),
  );
  const [activeCatId, setActiveCatId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<
    "all" | "pending" | "completed"
  >("all");
  const [pendingFilter, setPendingFilter] = useState<
    "all" | "overdue" | "due" | "outstanding"
  >("all");

  const changeCategory = (id: number | null) => {
    setActiveCatId(id);
    setStatusFilter("all");
    setPendingFilter("all"); // reset
  };

  const handleStatusChange = (status: "all" | "pending" | "completed") => {
    setStatusFilter(status);
    setPendingFilter("all");
  };

  const isToday = (iso: string | null) => {
    if (!iso) return false;
    const d = new Date(iso);
    const today = new Date();
    return d.toDateString() === today.toDateString();
  };

  const isFuture = (iso: string | null) => {
    if (!iso) return false;
    const d = new Date(iso);
    const today = new Date();
    return d > today && !isToday(iso);
  };


  const [showAddModal, setShowAddModal] = useState(false);

  // New todo form
  const [task, setTask] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [newCatId, setNewCatId] = useState<number>(1);

  // Sidebar
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [expandedCats, setExpandedCats] = useState<Set<number>>(new Set());

  // Context menus
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuAnchorRef = useRef<HTMLButtonElement | null>(null);

  // Category modal
  const [catModal, setCatModal] = useState(false);
  const [editCat, setEditCat] = useState<Category | null>(null);
  const [catName, setCatName] = useState("");
  const [catColor, setCatColor] = useState(PRESET_COLORS[0]);

  // Delete-category modal (choose: delete entirely vs move tasks to My Tasks)
  const [deleteCatTarget, setDeleteCatTarget] = useState<Category | null>(
    null,
  );
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  // Todo expand
  const [expandedTodos, setExpandedTodos] = useState<Set<number>>(new Set());
  const [subtaskInput, setSubtaskInput] = useState<{ [id: number]: string }>(
    {},
  );

  // Inline todo edit
  const [editingTodo, setEditingTodo] = useState<number | null>(null);
  const [editTask, setEditTask] = useState("");
  const [editDue, setEditDue] = useState("");
  const [editCatIdState, setEditCatIdState] = useState<number>(1);

  // Pull to refresh
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);

  // ── Offline / sync state ─────────────────────────────────────────────────

  const [isOnline, setIsOnline] = useState(true);
  const [queue, setQueue] = useState<QueueAction[]>(() =>
    loadLS<QueueAction[]>(LS_QUEUE, []),
  );
  const [conflicts, setConflicts] = useState<Conflict[]>(() =>
    loadLS<Conflict[]>(LS_CONFLICTS, []),
  );
  const [syncing, setSyncing] = useState(false);

  const todosRef = useRef<Todo[]>([]);
  const categoriesRef = useRef<Category[]>([]);
  const queueRef = useRef<QueueAction[]>([]);
  const syncingRef = useRef(false);
  const nextTempIdRef = useRef(-1);

  useEffect(() => {
    todosRef.current = todos;
    saveLS(LS_TODOS, todos);
  }, [todos]);
  useEffect(() => {
    categoriesRef.current = categories;
    saveLS(LS_CATS, categories);
  }, [categories]);
  useEffect(() => {
    queueRef.current = queue;
    saveLS(LS_QUEUE, queue);
  }, [queue]);
  useEffect(() => {
    saveLS(LS_CONFLICTS, conflicts);
  }, [conflicts]);

  const nextTempId = () => nextTempIdRef.current--;

  // ── Notification settings ────────────────────────────────────────────────

  const [settings, setSettings] = useState<AppSettings>({
    notifyDueTodayEnabled: true,
    defaultReminderMessage: 'Task "{task}" is due today!',
  });
  const [settingsModal, setSettingsModal] = useState(false);
  const [notifPermission, setNotifPermission] =
    useState<PermissionStatus["display"]>("prompt");

  // ── Data ──────────────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    const [tr, cr] = await Promise.all([
      axios.get<Todo[]>(`${API}/todos`),
      axios.get<Category[]>(`${API}/categories`),
    ]);
    setTodos(tr.data);
    setCategories(cr.data);
    setNewCatId((p) => {
      // default to first non-favourite category
      if (p === 1 && cr.data.length) {
        const nonFav = cr.data.find((c) => c.id !== FAVOURITE_ID);
        return nonFav ? nonFav.id : cr.data[0].id;
      }
      return p;
    });
  }, []);

  // Todos/categories start from cache (see useState initializers above);
  // refresh from the network on mount when available.
  useEffect(() => {
    fetchAll().catch(() => {
      // offline at startup — cached data (if any) stays on screen
    });

    axios
      .get<AppSettings>(`${API}/settings`)
      .then((r) => setSettings(r.data))
      .catch(() => {});
  }, [fetchAll]);

  // ── Network status + sync ────────────────────────────────────────────────

  useEffect(() => {
    let listenerHandle: { remove: () => void } | undefined;

    (async () => {
      try {
        const status = await Network.getStatus();
        setIsOnline(status.connected);
      } catch {
        setIsOnline(navigator.onLine);
      }
      try {
        const l = await Network.addListener("networkStatusChange", (s) => {
          setIsOnline(s.connected);
        });
        listenerHandle = l;
      } catch {
        const on = () => setIsOnline(true);
        const off = () => setIsOnline(false);
        window.addEventListener("online", on);
        window.addEventListener("offline", off);
        listenerHandle = {
          remove: () => {
            window.removeEventListener("online", on);
            window.removeEventListener("offline", off);
          },
        };
      }
    })();

    return () => listenerHandle?.remove();
  }, []);

  function remapAction(
    action: QueueAction,
    idMap: Record<number, number>,
  ): QueueAction {
    const r = (id: number) => idMap[id] ?? id;
    switch (action.kind) {
      case "createTodo":
        return { ...action, categoryId: r(action.categoryId) };
      case "updateTodo":
        return {
          ...action,
          todoId: r(action.todoId),
          changes:
            action.changes.categoryId !== undefined
              ? { ...action.changes, categoryId: r(action.changes.categoryId) }
              : action.changes,
        };
      case "deleteTodo":
        return { ...action, todoId: r(action.todoId) };
      case "updateCategory":
        return { ...action, catId: r(action.catId) };
      case "deleteCategoryMove":
        return { ...action, catId: r(action.catId) };
      case "deleteCategoryWithTasks":
        return { ...action, catId: r(action.catId) };
      default:
        return action;
    }
  }

  const addConflict = (c: Omit<Conflict, "id">) =>
    setConflicts((p) => [...p, { ...c, id: uid() }]);

  const resolveConflictKeepMine = async (c: Conflict) => {
    try {
      if (c.type === "todo") {
        const res = await axios.patch<Todo>(
          `${API}/todos/${c.entityId}`,
          c.changes,
        );
        setTodos((p) => p.map((t) => (t.id === c.entityId ? res.data : t)));
      } else {
        const res = await axios.patch<Category>(
          `${API}/categories/${c.entityId}`,
          c.changes,
        );
        setCategories((p) =>
          p.map((cat) => (cat.id === c.entityId ? res.data : cat)),
        );
      }
    } finally {
      setConflicts((p) => p.filter((x) => x.id !== c.id));
    }
  };

  const resolveConflictKeepServer = (c: Conflict) => {
    if (c.type === "todo") {
      setTodos((p) =>
        p.map((t) => (t.id === c.entityId ? (c.server as Todo) : t)),
      );
    } else {
      setCategories((p) =>
        p.map((cat) => (cat.id === c.entityId ? (c.server as Category) : cat)),
      );
    }
    setConflicts((p) => p.filter((x) => x.id !== c.id));
  };

  // ── Local notifications ──────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      try {
        const status = await LocalNotifications.checkPermissions();
        if (status.display === "granted" || status.display === "denied") {
          setNotifPermission(status.display);
          return;
        }
        const req = await LocalNotifications.requestPermissions();
        setNotifPermission(req.display);
      } catch {
        // not running under Capacitor (e.g. plain browser dev) — skip silently
      }
    })();
  }, []);

  useEffect(() => {
    if (notifPermission !== "granted") return;
    scheduleAllReminders(todos, settings).catch(() => {});
  }, [todos, settings, notifPermission]);

  // ── Notification settings ────────────────────────────────────────────────

  const updateSettings = async (changes: Partial<AppSettings>) => {
    setSettings((p) => ({ ...p, ...changes }));
    if (!isOnline) return;
    try {
      const res = await axios.patch<AppSettings>(`${API}/settings`, changes);
      setSettings(res.data);
    } catch {
      // will simply retry from server state on next successful fetch
    }
  };

  // ── Per-task reminders (online-only) ─────────────────────────────────────

  const [reminderDaysInput, setReminderDaysInput] = useState<{
    [id: number]: string;
  }>({});
  const [reminderMsgInput, setReminderMsgInput] = useState<{
    [id: number]: string;
  }>({});

  const addReminder = async (todoId: number) => {
    if (!isOnline || todoId < 0) return;
    const days = parseInt(reminderDaysInput[todoId] ?? "0", 10);
    if (Number.isNaN(days) || days < 0) return;
    const message = reminderMsgInput[todoId]?.trim() || undefined;

    const res = await axios.post<Todo>(`${API}/todos/${todoId}/reminders`, {
      daysBefore: days,
      message,
    });
    setTodos((p) => p.map((t) => (t.id === todoId ? res.data : t)));
    setReminderDaysInput((p) => ({ ...p, [todoId]: "" }));
    setReminderMsgInput((p) => ({ ...p, [todoId]: "" }));
  };

  const toggleReminder = async (
    todoId: number,
    reminderId: number,
    enabled: boolean,
  ) => {
    if (!isOnline) return;
    const res = await axios.patch<Todo>(
      `${API}/todos/${todoId}/reminders/${reminderId}`,
      { enabled: !enabled },
    );
    setTodos((p) => p.map((t) => (t.id === todoId ? res.data : t)));
  };

  const editReminderMessage = async (
    todoId: number,
    reminderId: number,
    message: string,
  ) => {
    if (!isOnline) return;
    const res = await axios.patch<Todo>(
      `${API}/todos/${todoId}/reminders/${reminderId}`,
      { message },
    );
    setTodos((p) => p.map((t) => (t.id === todoId ? res.data : t)));
  };

  const deleteReminder = async (todoId: number, reminderId: number) => {
    if (!isOnline) return;
    const res = await axios.delete<Todo>(
      `${API}/todos/${todoId}/reminders/${reminderId}`,
    );
    setTodos((p) => p.map((t) => (t.id === todoId ? res.data : t)));
  };

  async function syncQueue() {
    if (syncingRef.current) return;
    if (queueRef.current.length === 0) return;
    syncingRef.current = true;
    setSyncing(true);

    const idMap: Record<number, number> = {};
    const remaining: QueueAction[] = [];
    let stop = false;

    for (const raw of queueRef.current) {
      if (stop) {
        remaining.push(raw);
        continue;
      }

      const action = remapAction(raw, idMap);

      try {
        if (action.kind === "createTodo") {
          const res = await axios.post<Todo>(`${API}/todos`, {
            task: action.task,
            dueDate: action.dueDate,
            categoryId: action.categoryId,
          });
          idMap[action.tempId] = res.data.id;
          setTodos((p) =>
            p.map((t) => (t.id === action.tempId ? res.data : t)),
          );
        } else if (action.kind === "updateTodo") {
          try {
            const res = await axios.patch<Todo>(
              `${API}/todos/${action.todoId}`,
              { ...action.changes, expectedUpdatedAt: action.expectedUpdatedAt },
            );
            setTodos((p) =>
              p.map((t) => (t.id === action.todoId ? res.data : t)),
            );
          } catch (err) {
            const status = axios.isAxiosError(err)
              ? err.response?.status
              : undefined;
            if (status === 409 && axios.isAxiosError(err)) {
              const local = todosRef.current.find(
                (t) => t.id === action.todoId,
              );
              if (local) {
                addConflict({
                  type: "todo",
                  entityId: action.todoId,
                  local,
                  server: err.response!.data.server,
                  changes: action.changes,
                });
              }
            } else if (status === 404) {
              setTodos((p) => p.filter((t) => t.id !== action.todoId));
            } else {
              throw err;
            }
          }
        } else if (action.kind === "deleteTodo") {
          try {
            await axios.delete(`${API}/todos/${action.todoId}`);
          } catch (err) {
            if (!axios.isAxiosError(err) || err.response?.status !== 404) {
              throw err;
            }
          }
        } else if (action.kind === "createCategory") {
          const res = await axios.post<Category>(`${API}/categories`, {
            name: action.name,
            color: action.color,
          });
          idMap[action.tempId] = res.data.id;
          setCategories((p) =>
            p.map((c) => (c.id === action.tempId ? res.data : c)),
          );
        } else if (action.kind === "updateCategory") {
          try {
            const res = await axios.patch<Category>(
              `${API}/categories/${action.catId}`,
              { ...action.changes, expectedUpdatedAt: action.expectedUpdatedAt },
            );
            setCategories((p) =>
              p.map((c) => (c.id === action.catId ? res.data : c)),
            );
          } catch (err) {
            const status = axios.isAxiosError(err)
              ? err.response?.status
              : undefined;
            if (status === 409 && axios.isAxiosError(err)) {
              const local = categoriesRef.current.find(
                (c) => c.id === action.catId,
              );
              if (local) {
                addConflict({
                  type: "category",
                  entityId: action.catId,
                  local,
                  server: err.response!.data.server,
                  changes: action.changes,
                });
              }
            } else if (status === 404) {
              setCategories((p) => p.filter((c) => c.id !== action.catId));
            } else {
              throw err;
            }
          }
        } else if (action.kind === "deleteCategoryMove") {
          try {
            await axios.delete(`${API}/categories/${action.catId}`);
          } catch (err) {
            if (
              !axios.isAxiosError(err) ||
              (err.response?.status !== 404 && err.response?.status !== 403)
            ) {
              throw err;
            }
          }
        } else if (action.kind === "deleteCategoryWithTasks") {
          try {
            await axios.delete(`${API}/categories/${action.catId}/with-tasks`);
          } catch (err) {
            if (
              !axios.isAxiosError(err) ||
              (err.response?.status !== 404 && err.response?.status !== 403)
            ) {
              throw err;
            }
          }
        }
      } catch {
        // genuine network failure — stop draining, keep remaining actions queued
        stop = true;
        remaining.push(raw);
      }
    }

    setQueue(remaining);
    syncingRef.current = false;
    setSyncing(false);

    if (!stop) {
      await fetchAll().catch(() => {});
    }
  }

  useEffect(() => {
    if (isOnline) syncQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  const handleTouchStart = (e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY;
  };
  const handleTouchEnd = async (e: React.TouchEvent) => {
    if (
      e.changedTouches[0].clientY - startY.current > 100 &&
      window.scrollY === 0
    ) {
      setRefreshing(true);
      await fetchAll();
      setRefreshing(false);
    }
  };

  // Visible todos: Favourite shows all favourited regardless of categoryId
  const visibleTodos = (() => {
    let filtered: Todo[];

    // 1. Category filter
    if (activeCatId === null) {
      filtered = todos;
    } else if (activeCatId === FAVOURITE_ID) {
      filtered = todos.filter((t) => t.favourited);
    } else {
      filtered = todos.filter((t) => t.categoryId === activeCatId);
    }

    // 2. Status filter
    if (statusFilter === "completed") {
      return filtered.filter((t) => t.completed);
    }

    if (statusFilter === "pending") {
      let pending = filtered.filter((t) => !t.completed);

      // 3. Apply pending sub-filter
      if (pendingFilter === "overdue") {
        return pending.filter((t) => overdue(t.dueDate));
      }

      if (pendingFilter === "due") {
        return pending.filter((t) => isToday(t.dueDate));
      }

      if (pendingFilter === "outstanding") {
        return pending.filter((t) => !t.dueDate || isFuture(t.dueDate));
      }

      return pending; // "all"
    }

    return filtered; // "all"
  })();
  // ── Todo CRUD ─────────────────────────────────────────────────────────────

  const optimisticTodo = (
    id: number,
    task: string,
    dueDate: string | null,
    categoryId: number,
  ): Todo => ({
    id,
    task,
    completed: false,
    dueDate,
    categoryId,
    subtasks: [],
    reminders: [],
    favourited: false,
  });

  const addTodo = async (catOverride?: number) => {
    if (!task.trim()) return;
    const targetCat = catOverride ?? newCatId;
    if (targetCat === FAVOURITE_ID) return; // guard
    const payload = {
      task: task.trim(),
      dueDate: dueDate || null,
      categoryId: targetCat,
    };

    if (!isOnline) {
      const tempId = nextTempId();
      setTodos((p) => [
        ...p,
        optimisticTodo(tempId, payload.task, payload.dueDate, targetCat),
      ]);
      setQueue((p) => [
        ...p,
        { id: uid(), kind: "createTodo", tempId, ...payload },
      ]);
      setTask("");
      setDueDate("");
      return;
    }

    try {
      const res = await axios.post<Todo>(`${API}/todos`, payload);
      setTodos((p) => [...p, res.data]);
    } catch (err) {
      if (!axios.isAxiosError(err) || !err.response) {
        const tempId = nextTempId();
        setTodos((p) => [
          ...p,
          optimisticTodo(tempId, payload.task, payload.dueDate, targetCat),
        ]);
        setQueue((p) => [
          ...p,
          { id: uid(), kind: "createTodo", tempId, ...payload },
        ]);
      } else {
        throw err;
      }
    }
    setTask("");
    setDueDate("");
  };

  const addTodoInCat = async (t: string, catId: number) => {
    if (!t.trim() || catId === FAVOURITE_ID) return;
    const payload = { task: t.trim(), dueDate: null, categoryId: catId };

    if (!isOnline) {
      const tempId = nextTempId();
      setTodos((p) => [
        ...p,
        optimisticTodo(tempId, payload.task, null, catId),
      ]);
      setQueue((p) => [
        ...p,
        { id: uid(), kind: "createTodo", tempId, ...payload },
      ]);
      return;
    }

    try {
      const res = await axios.post<Todo>(`${API}/todos`, payload);
      setTodos((p) => [...p, res.data]);
    } catch (err) {
      if (!axios.isAxiosError(err) || !err.response) {
        const tempId = nextTempId();
        setTodos((p) => [
          ...p,
          optimisticTodo(tempId, payload.task, null, catId),
        ]);
        setQueue((p) => [
          ...p,
          { id: uid(), kind: "createTodo", tempId, ...payload },
        ]);
      } else {
        throw err;
      }
    }
  };

  // Routes every todo field edit through the offline queue + conflict check
  const updateTodoFields = async (id: number, changes: TodoChanges) => {
    const current = todosRef.current.find((t) => t.id === id);
    if (!current) return;
    const expectedUpdatedAt = current.updatedAt ?? null;

    setTodos((p) => p.map((t) => (t.id === id ? { ...t, ...changes } : t)));

    if (id < 0) {
      // still-unsynced offline-created todo — fold into its pending create
      setQueue((p) =>
        p.map((a) =>
          a.kind === "createTodo" && a.tempId === id
            ? {
                ...a,
                task: changes.task ?? a.task,
                dueDate:
                  changes.dueDate !== undefined ? changes.dueDate : a.dueDate,
                categoryId: changes.categoryId ?? a.categoryId,
              }
            : a,
        ),
      );
      return;
    }

    if (!isOnline) {
      setQueue((p) => [
        ...p,
        { id: uid(), kind: "updateTodo", todoId: id, changes, expectedUpdatedAt },
      ]);
      return;
    }

    try {
      const res = await axios.patch<Todo>(`${API}/todos/${id}`, {
        ...changes,
        expectedUpdatedAt,
      });
      setTodos((p) => p.map((t) => (t.id === id ? res.data : t)));
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        addConflict({
          type: "todo",
          entityId: id,
          local: { ...current, ...changes },
          server: err.response.data.server,
          changes,
        });
      } else if (!axios.isAxiosError(err) || !err.response) {
        setQueue((p) => [
          ...p,
          { id: uid(), kind: "updateTodo", todoId: id, changes, expectedUpdatedAt },
        ]);
      } else {
        throw err;
      }
    }
  };

  const toggleTodo = (id: number, completed: boolean) =>
    updateTodoFields(id, { completed: !completed });

  const toggleFavourite = (id: number) => {
    const current = todosRef.current.find((t) => t.id === id);
    if (!current) return;
    return updateTodoFields(id, { favourited: !current.favourited });
  };

  const deleteTodo = async (id: number) => {
    setTodos((p) => p.filter((t) => t.id !== id));
    setExpandedTodos((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });

    if (id < 0) {
      setQueue((p) =>
        p.filter(
          (a) =>
            !(a.kind === "createTodo" && a.tempId === id) &&
            !(a.kind === "updateTodo" && a.todoId === id),
        ),
      );
      return;
    }

    if (!isOnline) {
      setQueue((p) => [
        ...p.filter((a) => !(a.kind === "updateTodo" && a.todoId === id)),
        { id: uid(), kind: "deleteTodo", todoId: id },
      ]);
      return;
    }

    try {
      await axios.delete(`${API}/todos/${id}`);
    } catch (err) {
      if (!axios.isAxiosError(err) || !err.response) {
        setQueue((p) => [...p, { id: uid(), kind: "deleteTodo", todoId: id }]);
      }
    }
  };

  const saveEditTodo = async (id: number) => {
    if (!editTask.trim()) return;
    const catId = editCatIdState === FAVOURITE_ID ? 1 : editCatIdState;
    await updateTodoFields(id, {
      task: editTask.trim(),
      dueDate: editDue || null,
      categoryId: catId,
    });
    setEditingTodo(null);
  };

  const startEdit = (todo: Todo) => {
    setEditingTodo(todo.id);
    setEditTask(todo.task);
    setEditDue(todo.dueDate || "");
    setEditCatIdState(todo.categoryId === FAVOURITE_ID ? 1 : todo.categoryId);
  };

  const moveTodoCat = (id: number, categoryId: number) => {
    if (categoryId === FAVOURITE_ID) return; // star logic only
    return updateTodoFields(id, { categoryId });
  };

  // ── Subtasks & reminders (online-only — see offline banner) ────────────────

  const addSubtask = async (todoId: number) => {
    const t = subtaskInput[todoId]?.trim();
    if (!t || !isOnline || todoId < 0) return;
    const res = await axios.post<Todo>(`${API}/todos/${todoId}/subtasks`, {
      task: t,
    });
    setTodos((p) => p.map((td) => (td.id === todoId ? res.data : td)));
    setSubtaskInput((p) => ({ ...p, [todoId]: "" }));
  };

  const toggleSubtask = async (
    tid: number,
    sid: number,
    completed: boolean,
  ) => {
    if (!isOnline) return;
    const res = await axios.patch<Todo>(`${API}/todos/${tid}/subtasks/${sid}`, {
      completed: !completed,
    });
    setTodos((p) => p.map((t) => (t.id === tid ? res.data : t)));
  };

  const deleteSubtask = async (tid: number, sid: number) => {
    if (!isOnline) return;
    const res = await axios.delete<Todo>(`${API}/todos/${tid}/subtasks/${sid}`);
    setTodos((p) => p.map((t) => (t.id === tid ? res.data : t)));
  };

  // ── Categories ────────────────────────────────────────────────────────────

  const openNewCat = () => {
    setEditCat(null);
    setCatName("");
    setCatColor(PRESET_COLORS[0]);
    setCatModal(true);
  };
  const openEditCat = (c: Category) => {
    setEditCat(c);
    setCatName(c.name);
    setCatColor(c.color);
    setCatModal(true);
  };

  const saveCat = async () => {
    if (!catName.trim()) return;
    const name = catName.trim();
    const color = catColor;

    if (editCat) {
      const catId = editCat.id;
      const changes: CatChanges = { name, color };
      const current = categoriesRef.current.find((c) => c.id === catId);
      const expectedUpdatedAt = current?.updatedAt ?? null;

      setCategories((p) =>
        p.map((c) => (c.id === catId ? { ...c, ...changes } : c)),
      );
      setCatModal(false);

      if (catId < 0) {
        setQueue((p) =>
          p.map((a) =>
            a.kind === "createCategory" && a.tempId === catId
              ? { ...a, name, color }
              : a,
          ),
        );
        return;
      }

      if (!isOnline) {
        setQueue((p) => [
          ...p,
          { id: uid(), kind: "updateCategory", catId, changes, expectedUpdatedAt },
        ]);
        return;
      }

      try {
        const res = await axios.patch<Category>(`${API}/categories/${catId}`, {
          ...changes,
          expectedUpdatedAt,
        });
        setCategories((p) => p.map((c) => (c.id === catId ? res.data : c)));
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 409 && current) {
          addConflict({
            type: "category",
            entityId: catId,
            local: { ...current, ...changes },
            server: err.response.data.server,
            changes,
          });
        } else if (!axios.isAxiosError(err) || !err.response) {
          setQueue((p) => [
            ...p,
            { id: uid(), kind: "updateCategory", catId, changes, expectedUpdatedAt },
          ]);
        }
      }
    } else {
      setCatModal(false);

      if (!isOnline) {
        const tempId = nextTempId();
        setCategories((p) => [
          ...p,
          { id: tempId, name, color, locked: false },
        ]);
        setQueue((p) => [
          ...p,
          { id: uid(), kind: "createCategory", tempId, name, color },
        ]);
        return;
      }

      try {
        const res = await axios.post<Category>(`${API}/categories`, {
          name,
          color,
        });
        setCategories((p) => [...p, res.data]);
      } catch (err) {
        if (!axios.isAxiosError(err) || !err.response) {
          const tempId = nextTempId();
          setCategories((p) => [
            ...p,
            { id: tempId, name, color, locked: false },
          ]);
          setQueue((p) => [
            ...p,
            { id: uid(), kind: "createCategory", tempId, name, color },
          ]);
        } else {
          throw err;
        }
      }
    }
  };

  // Move tasks to "My Tasks" then delete the category
  const deleteCatMoveTasks = async (id: number) => {
    setCategories((p) => p.filter((c) => c.id !== id));
    setTodos((p) =>
      p.map((t) => (t.categoryId === id ? { ...t, categoryId: 1 } : t)),
    );
    if (activeCatId === id) setActiveCatId(null);
    setDeleteCatTarget(null);

    if (id < 0) {
      setQueue((p) =>
        p.filter(
          (a) =>
            !(a.kind === "createCategory" && a.tempId === id) &&
            !(a.kind === "updateCategory" && a.catId === id),
        ),
      );
      return;
    }

    if (!isOnline) {
      setQueue((p) => [
        ...p.filter((a) => !(a.kind === "updateCategory" && a.catId === id)),
        { id: uid(), kind: "deleteCategoryMove", catId: id },
      ]);
      return;
    }

    try {
      await axios.delete(`${API}/categories/${id}`);
      await fetchAll();
    } catch (err) {
      if (!axios.isAxiosError(err) || !err.response) {
        setQueue((p) => [
          ...p,
          { id: uid(), kind: "deleteCategoryMove", catId: id },
        ]);
      }
    }
  };

  // Delete the category along with all of its tasks
  const deleteCatWithTasks = async (id: number) => {
    setCategories((p) => p.filter((c) => c.id !== id));
    setTodos((p) => p.filter((t) => t.categoryId !== id));
    if (activeCatId === id) setActiveCatId(null);
    setDeleteCatTarget(null);

    if (id < 0) {
      setQueue((p) =>
        p.filter(
          (a) =>
            !(a.kind === "createCategory" && a.tempId === id) &&
            !(a.kind === "updateCategory" && a.catId === id),
        ),
      );
      return;
    }

    if (!isOnline) {
      setQueue((p) => [
        ...p.filter((a) => !(a.kind === "updateCategory" && a.catId === id)),
        { id: uid(), kind: "deleteCategoryWithTasks", catId: id },
      ]);
      return;
    }

    try {
      await axios.delete(`${API}/categories/${id}/with-tasks`);
      await fetchAll();
    } catch (err) {
      if (!axios.isAxiosError(err) || !err.response) {
        setQueue((p) => [
          ...p,
          { id: uid(), kind: "deleteCategoryWithTasks", catId: id },
        ]);
      }
    }
  };

  // Long-press handling for mobile category chips
  const startLongPress = (cat: Category) => {
    if (cat.locked) return;
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      if (navigator.vibrate) navigator.vibrate(30);
      setDeleteCatTarget(cat);
    }, 550);
  };
  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // ── UI helpers ────────────────────────────────────────────────────────────

  const getCat = (id: number) => categories.find((c) => c.id === id);
  const isFavouriteView = activeCatId === FAVOURITE_ID;

  const toggleCatExpand = (id: number) =>
    setExpandedCats((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const toggleTodoExpand = (id: number) =>
    setExpandedTodos((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const openCtx = (key: string, btn: HTMLButtonElement) => {
    menuAnchorRef.current = btn;
    setOpenMenu((p) => (p === key ? null : key));
  };

  const selectedCategory = getCat(newCatId);

  // Non-favourite categories for selects/chips
  const nonFavCats = categories.filter((c) => c.id !== FAVOURITE_ID);

  // ── Counts ─────────────────────────────────────────────

  const baseFiltered = (() => {
    if (activeCatId === null) return todos;
    if (activeCatId === FAVOURITE_ID) return todos.filter((t) => t.favourited);
    return todos.filter((t) => t.categoryId === activeCatId);
  })();

  const pendingTodos = baseFiltered.filter((t) => !t.completed);

  const counts = {
    all: baseFiltered.length,
    pending: pendingTodos.length,
    completed: baseFiltered.filter((t) => t.completed).length,

    overdue: pendingTodos.filter((t) => overdue(t.dueDate)).length,
    due: pendingTodos.filter((t) => isToday(t.dueDate)).length,
    outstanding: pendingTodos.filter((t) => !t.dueDate || isFuture(t.dueDate))
      .length,
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{CSS}</style>

      {/* Category modal */}
      {catModal && (
        <div className="modal-overlay" onClick={() => setCatModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">
              {editCat ? "Edit Category" : "New Category"}
            </h3>
            <input
              className="modal-input"
              placeholder="Name…"
              value={catName}
              autoFocus
              onChange={(e) => setCatName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveCat()}
            />
            <div className="color-row">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  className={`color-swatch${catColor === c ? " active" : ""}`}
                  style={{ background: c }}
                  onClick={() => setCatColor(c)}
                />
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setCatModal(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={saveCat}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete-category modal */}
      {deleteCatTarget && (
        <div
          className="modal-overlay"
          onClick={() => setDeleteCatTarget(null)}
        >
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">
              Delete "{deleteCatTarget.name}"?
            </h3>
            <p className="modal-desc">
              What should happen to the tasks in this category?
            </p>
            <div className="modal-actions modal-actions-col">
              <button
                className="btn-primary"
                onClick={() => deleteCatMoveTasks(deleteCatTarget.id)}
              >
                Move tasks to My Tasks
              </button>
              <button
                className="btn-danger"
                onClick={() => deleteCatWithTasks(deleteCatTarget.id)}
              >
                Delete category and its tasks
              </button>
              <button
                className="btn-ghost"
                onClick={() => setDeleteCatTarget(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notification settings modal */}
      {settingsModal && (
        <div
          className="modal-overlay"
          onClick={() => setSettingsModal(false)}
        >
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Notification Settings</h3>

            <label className="settings-row">
              <span>Notify me when a task is due today</span>
              <input
                type="checkbox"
                checked={settings.notifyDueTodayEnabled}
                onChange={(e) =>
                  updateSettings({ notifyDueTodayEnabled: e.target.checked })
                }
              />
            </label>

            <p className="modal-desc" style={{ marginTop: 12 }}>
              Default reminder message (use {"{task}"} for the task name)
            </p>
            <input
              className="modal-input"
              value={settings.defaultReminderMessage}
              onChange={(e) =>
                setSettings((p) => ({
                  ...p,
                  defaultReminderMessage: e.target.value,
                }))
              }
              onBlur={(e) =>
                updateSettings({ defaultReminderMessage: e.target.value })
              }
            />

            {notifPermission !== "granted" && (
              <p className="modal-desc" style={{ color: "var(--danger)" }}>
                Notifications are {notifPermission} on this device — enable
                them in system settings to receive reminders.
              </p>
            )}

            <div className="modal-actions">
              <button
                className="btn-primary"
                onClick={() => setSettingsModal(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Conflict resolution modal */}
      {conflicts.length > 0 && (
        <div className="modal-overlay">
          <div className="modal-box">
            <h3 className="modal-title">Resolve sync conflicts</h3>
            <p className="modal-desc">
              These changed both on this device (while offline) and elsewhere
              since you were last online. Choose which version to keep.
            </p>
            <div className="conflict-list">
              {conflicts.map((c) => {
                const localLabel =
                  c.type === "todo"
                    ? (c.local as Todo).task
                    : (c.local as Category).name;
                const serverLabel =
                  c.type === "todo"
                    ? (c.server as Todo).task
                    : (c.server as Category).name;
                return (
                  <div key={c.id} className="conflict-item">
                    <div className="conflict-item-title">
                      {c.type === "todo" ? "Task" : "Category"}: "
                      {serverLabel}"
                    </div>
                    <div className="conflict-item-versions">
                      <span>Yours: "{localLabel}"</span>
                      <span>Server: "{serverLabel}"</span>
                    </div>
                    <div className="modal-actions">
                      <button
                        className="btn-ghost"
                        onClick={() => resolveConflictKeepServer(c)}
                      >
                        Keep server's
                      </button>
                      <button
                        className="btn-primary"
                        onClick={() => resolveConflictKeepMine(c)}
                      >
                        Keep mine
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div
        className="layout"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <aside className={`sidebar${sidebarOpen ? " open" : " closed"}`}>
          <button
            className="sidebar-toggle"
            onClick={() => setSidebarOpen((p) => !p)}
          >
            {sidebarOpen ? "◂" : "▸"}
          </button>

          {sidebarOpen && (
            <>
              <div className="sidebar-header">
                <span className="sidebar-logo">✦ Lists</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    className="add-cat-icon"
                    onClick={() => setSettingsModal(true)}
                    title="Notification settings"
                  >
                    🔔
                  </button>
                  <button
                    className="add-cat-icon"
                    onClick={openNewCat}
                    title="New category"
                  >
                    +
                  </button>
                </div>
              </div>

              <nav className="sidebar-nav">
                {/* All Tasks */}
                <button
                  className={`cat-item${activeCatId === null ? " active" : ""}`}
                  onClick={() => changeCategory(null)}
                >
                  <span style={{ fontSize: 12 }}>◈</span>
                  <span className="cat-label">All Tasks</span>
                  <span className="cat-count">{todos.length}</span>
                </button>

                {/* Per-category */}
                {categories.map((cat) => {
                  const isFav = cat.id === FAVOURITE_ID;
                  const catTodos = isFav
                    ? todos.filter((t) => t.favourited)
                    : todos.filter((t) => t.categoryId === cat.id);
                  const expanded = expandedCats.has(cat.id);
                  const mKey = `cat-${cat.id}`;

                  return (
                    <div key={cat.id} className="sb-cat-group">
                      {/* Header row */}
                      <div
                        className={`sb-cat-row${activeCatId === cat.id ? " active" : ""}`}
                      >
                        <button
                          className="chevron-btn"
                          onClick={() => toggleCatExpand(cat.id)}
                        >
                          <span className={`chevron${expanded ? " open" : ""}`}>
                            ›
                          </span>
                        </button>
                        <button
                          className="cat-name-btn"
                          onClick={() => changeCategory(cat.id)}
                        >
                          {isFav ? (
                            <span style={{ fontSize: 13 }}>★</span>
                          ) : (
                            <ColorDot color={cat.color} />
                          )}
                          <span className="cat-label">{cat.name}</span>
                          <span className="cat-count">{catTodos.length}</span>
                        </button>
                        {/* Only show dots menu for non-locked categories */}
                        {!cat.locked && (
                          <button
                            className="dots-btn"
                            onClick={(e) => openCtx(mKey, e.currentTarget)}
                          >
                            ···
                          </button>
                        )}
                        {openMenu === mKey && !cat.locked && (
                          <ContextMenu
                            anchorRef={menuAnchorRef}
                            onClose={() => setOpenMenu(null)}
                            items={[
                              {
                                label: "Edit category",
                                icon: "✎",
                                onClick: () => openEditCat(cat),
                              },
                              {
                                label: "Add task here",
                                icon: "+",
                                onClick: () => {
                                  setActiveCatId(cat.id);
                                  setNewCatId(cat.id);
                                },
                              },
                              {
                                label: "Delete category",
                                icon: "✕",
                                danger: true,
                                onClick: () => setDeleteCatTarget(cat),
                              },
                            ]}
                          />
                        )}
                      </div>

                      {/* Task glimpses */}
                      {expanded && (
                        <ul className="sb-tasks">
                          {catTodos.length === 0 && (
                            <li className="sb-empty">
                              {isFav
                                ? "No favourites yet — star a task ★"
                                : "No tasks yet"}
                            </li>
                          )}

                          {catTodos.map((todo) => {
                            const tKey = `sbtodo-${todo.id}`;
                            return (
                              <li
                                key={todo.id}
                                className={`sb-task${todo.completed ? " done" : ""}`}
                              >
                                <button
                                  className={`check-btn small${todo.completed ? " checked" : ""}`}
                                  onClick={() =>
                                    toggleTodo(todo.id, todo.completed)
                                  }
                                >
                                  {todo.completed ? "✓" : ""}
                                </button>
                                <span
                                  className={`sb-task-text${todo.completed ? " struck" : ""}`}
                                  title={todo.task}
                                >
                                  {trunc(todo.task)}
                                </span>
                                {todo.dueDate && (
                                  <span
                                    className={`sb-due${overdue(todo.dueDate) && !todo.completed ? " over" : ""}`}
                                  >
                                    {fmt(todo.dueDate)}
                                  </span>
                                )}
                                {/* Star in sidebar glimpse */}
                                <button
                                  className={`sb-star${todo.favourited ? " on" : ""}`}
                                  onClick={() => toggleFavourite(todo.id)}
                                  title={
                                    todo.favourited
                                      ? "Remove from Favourites"
                                      : "Add to Favourites"
                                  }
                                >
                                  {todo.favourited ? "★" : "☆"}
                                </button>
                                <button
                                  className="dots-btn sm"
                                  onClick={(e) =>
                                    openCtx(tKey, e.currentTarget)
                                  }
                                >
                                  ···
                                </button>
                                {openMenu === tKey && (
                                  <ContextMenu
                                    anchorRef={menuAnchorRef}
                                    onClose={() => setOpenMenu(null)}
                                    items={[
                                      {
                                        label: "Add subtask",
                                        icon: "↳",
                                        onClick: () => {
                                          setExpandedTodos((s) => {
                                            const n = new Set(s);
                                            n.add(todo.id);
                                            return n;
                                          });
                                          setActiveCatId(null);
                                        },
                                      },
                                      {
                                        label: "Edit task",
                                        icon: "✎",
                                        onClick: () => {
                                          startEdit(todo);
                                          setActiveCatId(null);
                                        },
                                      },
                                      {
                                        label: todo.favourited
                                          ? "Remove from Favourites"
                                          : "Add to Favourites",
                                        icon: todo.favourited ? "★" : "☆",
                                        onClick: () => toggleFavourite(todo.id),
                                      },
                                      {
                                        label: "Delete task",
                                        icon: "✕",
                                        danger: true,
                                        onClick: () => deleteTodo(todo.id),
                                      },
                                    ]}
                                  />
                                )}
                              </li>
                            );
                          })}

                          {/* Quick-add in sidebar (not for Favourite) */}
                          {!isFav && (
                            <li className="sb-quick">
                              <input
                                className="sb-quick-input"
                                placeholder="+ Quick add…"
                                onKeyDown={async (e) => {
                                  const inp = e.target as HTMLInputElement;
                                  if (e.key === "Enter" && inp.value.trim()) {
                                    await addTodoInCat(
                                      inp.value.trim(),
                                      cat.id,
                                    );
                                    inp.value = "";
                                  }
                                }}
                              />
                            </li>
                          )}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </nav>

              <button className="add-cat-btn" onClick={openNewCat}>
                + New Category
              </button>
            </>
          )}
        </aside>

        {/* ── Main ────────────────────────────────────────────────────────── */}
        <main className="main">
          {refreshing && <div className="refresh-bar">Syncing…</div>}

          {!isOnline && (
            <div className="offline-bar">
              📴 Offline — changes are saved on this device
              {queue.length > 0 ? ` (${queue.length} pending)` : ""}
            </div>
          )}
          {isOnline && syncing && (
            <div className="refresh-bar">Syncing {queue.length} change(s)…</div>
          )}
          {isOnline && conflicts.length > 0 && (
            <div className="conflict-bar">
              ⚠️ {conflicts.length} change
              {conflicts.length === 1 ? "" : "s"} couldn't sync automatically —
              resolve below
            </div>
          )}

          {/* Mobile category bar */}
          <div className="mobile-cats">
            <button
              className={`mobile-cat${activeCatId === null ? " active" : ""}`}
              onClick={() => changeCategory(null)}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                className={`mobile-cat${activeCatId === cat.id ? " active" : ""}${cat.id === FAVOURITE_ID ? " fav-tab" : ""}`}
                style={
                  activeCatId === cat.id && cat.id !== FAVOURITE_ID
                    ? { borderColor: cat.color, color: cat.color }
                    : {}
                }
                onClick={() => {
                  if (longPressFired.current) {
                    longPressFired.current = false;
                    return;
                  }
                  changeCategory(cat.id);
                }}
                onTouchStart={() => startLongPress(cat)}
                onTouchEnd={cancelLongPress}
                onTouchMove={cancelLongPress}
                onContextMenu={(e) => {
                  // Long-press on Android WebView also fires contextmenu — suppress it.
                  if (!cat.locked) e.preventDefault();
                }}
                title={
                  !cat.locked ? "Hold to delete this category" : undefined
                }
              >
                {cat.id === FAVOURITE_ID ? (
                  <span>★ {cat.name}</span>
                ) : (
                  <>
                    <ColorDot color={cat.color} /> {cat.name}
                  </>
                )}
              </button>
            ))}
            <button className="mobile-cat add-mobile" onClick={openNewCat}>
              +
            </button>
          </div>

          {/* Page header */}
          <header className="page-header">
            <div className="page-title-row">
              {activeCatId === FAVOURITE_ID && (
                <span className="fav-icon-big">★</span>
              )}
              <h1 className="page-title">
                {activeCatId === null
                  ? "All Tasks"
                  : (getCat(activeCatId)?.name ?? "Tasks")}
              </h1>
            </div>
            <div className="page-header-right">
              <span className="task-count">{visibleTodos.length} tasks</span>
              {isFavouriteView && (
                <span className="fav-hint">
                  Star tasks from other lists to add here
                </span>
              )}
            </div>
          </header>

          


          <div className="tabs">
            <button
              className={`tab${statusFilter === "all" ? " active" : ""}`}
              onClick={() => handleStatusChange("all")}
            >
              All ({counts.all})
            </button>

            <button
              className={`tab${statusFilter === "pending" ? " active" : ""}`}
              onClick={() => handleStatusChange("pending")}
            >
              Pending ({counts.pending})
            </button>

            <button
              className={`tab${statusFilter === "completed" ? " active" : ""}`}
              onClick={() => handleStatusChange("completed")}
            >
              Completed ({counts.completed})
            </button>
          </div>

          {statusFilter === "pending" && (
            <div className="tabs">
              <button
                className={`tab${pendingFilter === "all" ? " active" : ""}`}
                onClick={() => setPendingFilter("all")}
              >
                All Pending ({counts.pending})
              </button>

              <button
                className={`tab${pendingFilter === "overdue" ? " active" : ""}`}
                onClick={() => setPendingFilter("overdue")}
              >
                Overdue ({counts.overdue})
              </button>

              <button
                className={`tab${pendingFilter === "due" ? " active" : ""}`}
                onClick={() => setPendingFilter("due")}
              >
                Due Today ({counts.due})
              </button>

              <button
                className={`tab${pendingFilter === "outstanding" ? " active" : ""}`}
                onClick={() => setPendingFilter("outstanding")}
              >
                Outstanding ({counts.outstanding})
              </button>
            </div>
          )}

          {/* Favourite view hint */}
          {isFavouriteView && visibleTodos.length === 0 && (
            <div className="fav-empty-state">
              <div className="fav-empty-star">☆</div>
              <p>No favourites yet</p>
              <p className="fav-empty-sub">
                Click the ☆ star on any task to add it here
              </p>
            </div>
          )}

          {/* Todo list */}
          <ul className="todo-list">
            {!isFavouriteView && visibleTodos.length === 0 && (
              <li className="empty-state">No tasks here. Add one above ↑</li>
            )}

            {visibleTodos.map((todo) => {
              const cat = getCat(todo.categoryId);
              const isExp = expandedTodos.has(todo.id);
              const isEdit = editingTodo === todo.id;
              const od = overdue(todo.dueDate) && !todo.completed;
              const subDone = todo.subtasks.filter((s) => s.completed).length;
              const mKey = `todo-${todo.id}`;

              return (
                <li
                  key={todo.id}
                  className={`todo-card${todo.completed ? " done" : ""}${isExp ? " exp" : ""}${todo.favourited ? " is-fav" : ""}`}
                >
                  {/* Top row */}
                  <div className="todo-top">
                    <button
                      className={`check-btn${todo.completed ? " checked" : ""}`}
                      onClick={() => toggleTodo(todo.id, todo.completed)}
                    >
                      {todo.completed ? "✓" : ""}
                    </button>

                    {/* Body */}
                    <div
                      className="todo-body"
                      style={{ cursor: isEdit ? "default" : "pointer" }}
                      onClick={() => !isEdit && toggleTodoExpand(todo.id)}
                    >
                      {isEdit ? (
                        <div
                          className="edit-form"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            className="edit-input"
                            value={editTask}
                            autoFocus
                            onChange={(e) => setEditTask(e.target.value)}
                            onKeyDown={(e) =>
                              e.key === "Enter" && saveEditTodo(todo.id)
                            }
                          />
                          <input
                            type="date"
                            className="edit-input"
                            value={editDue}
                            onChange={(e) => setEditDue(e.target.value)}
                          />
                          <select
                            className="edit-select"
                            value={editCatIdState}
                            onChange={(e) =>
                              setEditCatIdState(Number(e.target.value))
                            }
                          >
                            {nonFavCats.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                          <div className="edit-actions">
                            <button
                              className="btn-save"
                              onClick={() => saveEditTodo(todo.id)}
                            >
                              Save
                            </button>
                            <button
                              className="btn-ghost-sm"
                              onClick={() => setEditingTodo(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="todo-title-row">
                            <span
                              className={`todo-text${todo.completed ? " struck" : ""}`}
                            >
                              {todo.task}
                            </span>
                            <span
                              className={`expand-arrow${isExp ? " open" : ""}`}
                            >
                              ›
                            </span>
                          </div>
                          <div className="todo-meta">
                            {cat && cat.id !== FAVOURITE_ID && (
                              <span
                                className="meta-tag"
                                style={{
                                  background: cat.color + "20",
                                  color: cat.color,
                                }}
                              >
                                <ColorDot color={cat.color} /> {cat.name}
                              </span>
                            )}
                            {todo.dueDate && (
                              <span
                                className={`meta-tag${od ? " overdue" : ""}`}
                              >
                                📅 {fmt(todo.dueDate)}
                              </span>
                            )}
                            {todo.subtasks.length > 0 && (
                              <span className="meta-tag">
                                ✦ {subDone}/{todo.subtasks.length}
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    {/* Star button — always visible on right */}
                    {!isEdit && (
                      <StarButton
                        favourited={todo.favourited}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavourite(todo.id);
                        }}
                      />
                    )}

                    {/* ··· menu */}
                    {!isEdit && (
                      <div
                        className="todo-menu-wrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          className="dots-btn main"
                          onClick={(e) => openCtx(mKey, e.currentTarget)}
                        >
                          ···
                        </button>
                        {openMenu === mKey && (
                          <ContextMenu
                            anchorRef={menuAnchorRef}
                            onClose={() => setOpenMenu(null)}
                            items={[
                              {
                                label: isExp ? "Collapse" : "Expand",
                                icon: isExp ? "▲" : "▼",
                                onClick: () => toggleTodoExpand(todo.id),
                              },
                              {
                                label: "Edit task",
                                icon: "✎",
                                onClick: () => startEdit(todo),
                              },
                              {
                                label: "Add subtask",
                                icon: "↳",
                                onClick: () =>
                                  setExpandedTodos((s) => {
                                    const n = new Set(s);
                                    n.add(todo.id);
                                    return n;
                                  }),
                              },
                              {
                                label: todo.favourited
                                  ? "Remove from Favourites"
                                  : "Add to Favourites",
                                icon: todo.favourited ? "★" : "☆",
                                onClick: () => toggleFavourite(todo.id),
                              },
                              ...(!isFavouriteView
                                ? nonFavCats
                                    .filter((c) => c.id !== todo.categoryId)
                                    .map((c) => ({
                                      label: `Move → ${c.name}`,
                                      icon: "→",
                                      onClick: () => moveTodoCat(todo.id, c.id),
                                    }))
                                : []),
                              {
                                label: "Add new category",
                                icon: "+",
                                onClick: openNewCat,
                              },
                              {
                                label: "Delete task",
                                icon: "✕",
                                danger: true,
                                onClick: () => deleteTodo(todo.id),
                              },
                            ]}
                          />
                        )}
                      </div>
                    )}
                  </div>

                  {/* Expanded panel */}
                  {isExp && !isEdit && (
                    <div className="exp-panel">
                      <div className="exp-section">
                        <span className="exp-label">Subtasks</span>

                        <ul className="subtask-list">
                          {todo.subtasks.length === 0 && (
                            <li className="sub-empty">No subtasks</li>
                          )}

                          {todo.subtasks.map((s) => (
                            <li key={s.id} className="subtask-item">
                              <button
                                className={`check-btn small${s.completed ? " checked" : ""}`}
                                onClick={() =>
                                  toggleSubtask(todo.id, s.id, s.completed)
                                }
                              >
                                {s.completed ? "✓" : ""}
                              </button>

                              <span
                                className={`subtask-text${s.completed ? " struck" : ""}`}
                              >
                                {s.task}
                              </span>

                              <button
                                className="icon-btn danger sm"
                                onClick={() => deleteSubtask(todo.id, s.id)}
                              >
                                ✕
                              </button>
                            </li>
                          ))}
                        </ul>

                        <div className="subtask-add">
                          <input
                            className="form-input subtask-input"
                            placeholder="Add subtask…"
                            value={subtaskInput[todo.id] ?? ""}
                            onChange={(e) =>
                              setSubtaskInput((p) => ({
                                ...p,
                                [todo.id]: e.target.value,
                              }))
                            }
                            onKeyDown={(e) =>
                              e.key === "Enter" && addSubtask(todo.id)
                            }
                          />

                          <button
                            className="btn-sub-add"
                            onClick={() => addSubtask(todo.id)}
                            disabled={!isOnline || todo.id < 0}
                            title={
                              !isOnline || todo.id < 0
                                ? "Connect to the internet to add subtasks"
                                : "Add subtask"
                            }
                          >
                            +
                          </button>
                        </div>
                      </div>

                      {todo.dueDate && (
                        <div className="exp-section">
                          <span className="exp-label">Reminders</span>

                          <ul className="subtask-list">
                            {todo.reminders.length === 0 && (
                              <li className="sub-empty">No reminders</li>
                            )}

                            {todo.reminders.map((r) => (
                              <li key={r.id} className="reminder-item">
                                <button
                                  className={`check-btn small${r.enabled ? " checked" : ""}`}
                                  title={r.enabled ? "Enabled" : "Disabled"}
                                  onClick={() =>
                                    toggleReminder(todo.id, r.id, r.enabled)
                                  }
                                >
                                  {r.enabled ? "✓" : ""}
                                </button>

                                <span className="reminder-when">
                                  {r.daysBefore === 0
                                    ? "Due today"
                                    : `${r.daysBefore}d before`}
                                </span>

                                <input
                                  className="reminder-msg-input"
                                  placeholder={settings.defaultReminderMessage}
                                  defaultValue={r.message ?? ""}
                                  onBlur={(e) =>
                                    e.target.value.trim() !== (r.message ?? "") &&
                                    editReminderMessage(
                                      todo.id,
                                      r.id,
                                      e.target.value,
                                    )
                                  }
                                />

                                <button
                                  className="icon-btn danger sm"
                                  onClick={() => deleteReminder(todo.id, r.id)}
                                >
                                  ✕
                                </button>
                              </li>
                            ))}
                          </ul>

                          <div className="subtask-add">
                            <input
                              type="number"
                              min={0}
                              className="form-input reminder-days-input"
                              placeholder="Days before"
                              value={reminderDaysInput[todo.id] ?? ""}
                              onChange={(e) =>
                                setReminderDaysInput((p) => ({
                                  ...p,
                                  [todo.id]: e.target.value,
                                }))
                              }
                            />
                            <input
                              className="form-input subtask-input"
                              placeholder="Message (optional)…"
                              value={reminderMsgInput[todo.id] ?? ""}
                              onChange={(e) =>
                                setReminderMsgInput((p) => ({
                                  ...p,
                                  [todo.id]: e.target.value,
                                }))
                              }
                              onKeyDown={(e) =>
                                e.key === "Enter" && addReminder(todo.id)
                              }
                            />
                            <button
                              className="btn-sub-add"
                              onClick={() => addReminder(todo.id)}
                              disabled={!isOnline || todo.id < 0}
                              title={
                                !isOnline || todo.id < 0
                                  ? "Connect to the internet to add reminders"
                                  : "Add reminder"
                              }
                            >
                              +
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>


          {!isFavouriteView && (
  <button
    className="fab"
    onClick={() => setShowAddModal(true)}
    title="Add task"
  >
    +
  </button>
)}



{showAddModal && (
  <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
    <div className="modal-box" onClick={(e) => e.stopPropagation()}>
      <h3 className="modal-title">New Task</h3>

      <input
        className="modal-input"
        placeholder="What needs to be done?"
        value={task}
        autoFocus
        onChange={(e) => setTask(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && addTodo()}
      />

      <input
        type="date"
        className="modal-input"
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
      />

      <select
  className="modal-input"
  value={newCatId}
  onChange={(e) => setNewCatId(Number(e.target.value))}
  style={{
    borderColor: selectedCategory?.color,
    color: selectedCategory?.color,
  }}
>
        {nonFavCats.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <div className="modal-actions">
        <button
          className="btn-ghost"
          onClick={() => setShowAddModal(false)}
        >
          Cancel
        </button>
        <button
          className="btn-primary"
          onClick={() => {
            addTodo();
            setShowAddModal(false);
          }}
        >
          Add
        </button>
      </div>
    </div>
  </div>
)}



        </main>
      </div>
    </>
  );
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=Syne:wght@500;700&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #f8f7f4; --surface: #ffffff; --border: #e8e5e0;
    --text: #1a1814; --muted: #8a8580;
    --accent: #2d6a4f; --accent-light: #d8f3dc;
    --danger: #c9363e; --danger-light: #fde8e9;
    --fav: #f59e0b; --fav-light: #fef3c7;
    --radius: 14px; --shadow: 0 2px 12px rgba(0,0,0,0.06); --shadow-md: 0 8px 32px rgba(0,0,0,0.13);
    --font-body: 'DM Sans', sans-serif; --font-head: 'Syne', sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #141412; --surface: #1f1e1b; --border: #2e2c28;
      --text: #f0ede8; --muted: #6b6860;
      --accent: #52b788; --accent-light: #1b3a2a;
      --danger: #e05c63; --danger-light: #3a1a1c;
      --fav: #fbbf24; --fav-light: #2d2007;
    }
  }

  body { font-family: var(--font-body); background: var(--bg); color: var(--text); min-height: 100svh; }
  .layout { display: flex; min-height: 100svh; }

  /* ── Sidebar ── */
  .sidebar {
    position: relative; background: var(--surface); border-right: 1px solid var(--border);
    transition: width 0.25s ease; flex-shrink: 0; display: flex; flex-direction: column; overflow: hidden;
  }
  .sidebar.open { width: 270px; }
  .sidebar.closed { width: 44px; }

  .sidebar-toggle {
    position: absolute; top: 16px; right: -14px; width: 28px; height: 28px;
    border-radius: 50%; border: 1px solid var(--border); background: var(--surface);
    color: var(--muted); cursor: pointer; font-size: 13px;
    display: flex; align-items: center; justify-content: center; z-index: 10; transition: color 0.15s;
  }
  .sidebar-toggle:hover { color: var(--text); }

  .sidebar-header {
    padding: 18px 12px 12px; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; justify-content: space-between;
  }
  .sidebar-logo { font-family: var(--font-head); font-size: 15px; font-weight: 700; color: var(--text); }
  .add-cat-icon {
    width: 24px; height: 24px; border-radius: 6px; border: 1px solid var(--border);
    background: none; color: var(--muted); font-size: 16px; cursor: pointer;
    display: flex; align-items: center; justify-content: center; transition: all 0.13s;
  }
  .add-cat-icon:hover { border-color: var(--accent); color: var(--accent); }

  .sidebar-nav { padding: 6px; flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 1px; }

  .cat-item {
    width: 100%; display: flex; align-items: center; gap: 7px; padding: 7px 8px;
    border: none; background: none; color: var(--muted);
    font-family: var(--font-body); font-size: 13px; cursor: pointer; border-radius: 8px;
    transition: background 0.12s, color 0.12s; text-align: left;
  }
  .cat-item:hover { background: var(--bg); color: var(--text); }
  .cat-item.active { background: var(--accent-light); color: var(--accent); font-weight: 500; }

  /* Category group */
  .sb-cat-group { display: flex; flex-direction: column; }

  .sb-cat-row {
    display: flex; align-items: center; border-radius: 8px;
    position: relative; transition: background 0.12s;
  }
  .sb-cat-row:hover { background: var(--bg); }
  .sb-cat-row:hover .dots-btn { opacity: 1; }
  .sb-cat-row.active .cat-name-btn { color: var(--accent); font-weight: 500; }

  .chevron-btn {
    width: 24px; height: 30px; border: none; background: none; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; color: var(--muted); transition: color 0.12s;
  }
  .chevron-btn:hover { color: var(--text); }
  .chevron { display: inline-block; transition: transform 0.18s; font-size: 14px; }
  .chevron.open { transform: rotate(90deg); }

  .cat-name-btn {
    flex: 1; display: flex; align-items: center; gap: 7px; padding: 7px 2px;
    border: none; background: none; color: var(--muted);
    font-family: var(--font-body); font-size: 13px; cursor: pointer; text-align: left;
    transition: color 0.12s; overflow: hidden; min-width: 0;
  }
  .cat-name-btn:hover { color: var(--text); }
  .cat-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cat-count {
    font-size: 10px; background: var(--border); border-radius: 20px;
    padding: 1px 6px; color: var(--muted); flex-shrink: 0;
  }

  /* Dots button */
  .dots-btn {
    border: none; background: none; color: var(--muted); cursor: pointer;
    font-size: 16px; letter-spacing: 1.5px; padding: 3px 5px; border-radius: 6px;
    opacity: 0; transition: opacity 0.12s, background 0.12s, color 0.12s;
    flex-shrink: 0; line-height: 1;
  }
  .dots-btn.sm { font-size: 12px; padding: 1px 3px; }
  .dots-btn.main { opacity: 1; font-size: 17px; padding: 5px 8px; }
  .sb-cat-row:hover .dots-btn,
  .sb-task:hover .dots-btn { opacity: 1; }
  .dots-btn:hover { background: var(--border); color: var(--text); }

  /* Task glimpses */
  .sb-tasks {
    list-style: none; padding: 2px 0 4px 20px;
    display: flex; flex-direction: column; gap: 1px;
  }
  .sb-task {
    display: flex; align-items: center; gap: 5px; padding: 4px 6px;
    border-radius: 7px; transition: background 0.11s; position: relative;
  }
  .sb-task:hover { background: var(--bg); }
  .sb-task.done { opacity: 0.5; }
  .sb-task-text {
    flex: 1; font-size: 12.5px; color: var(--muted);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .sb-task-text.struck { text-decoration: line-through; }
  .sb-due { font-size: 10.5px; color: var(--muted); flex-shrink: 0; }
  .sb-due.over { color: var(--danger); }
  .sb-empty { font-size: 11.5px; color: var(--muted); padding: 3px 6px; font-style: italic; }

  /* Sidebar star */
  .sb-star {
    border: none; background: none; cursor: pointer; font-size: 13px;
    color: var(--muted); padding: 1px 2px; border-radius: 4px; flex-shrink: 0;
    transition: color 0.13s, opacity 0.12s; opacity: 0; line-height: 1;
  }
  .sb-star.on { color: var(--fav); opacity: 1; }
  .sb-task:hover .sb-star { opacity: 1; }
  .sb-star:hover { color: var(--fav); }

  .sb-quick { padding: 3px 0; }
  .sb-quick-input {
    width: 100%; padding: 4px 8px; border: 1px dashed var(--border); border-radius: 6px;
    background: none; color: var(--text); font-family: var(--font-body); font-size: 12px; outline: none;
    transition: border-color 0.12s;
  }
  .sb-quick-input:focus { border-color: var(--accent); }
  .sb-quick-input::placeholder { color: var(--muted); }

  .add-cat-btn {
    margin: 8px; padding: 8px; border: 1px dashed var(--border); border-radius: 8px;
    background: none; color: var(--muted); font-family: var(--font-body); font-size: 12.5px;
    cursor: pointer; transition: all 0.13s; text-align: center;
  }
  .add-cat-btn:hover { border-color: var(--accent); color: var(--accent); }

  /* Context menu */
  .ctx-menu {
    position: absolute; top: calc(100% + 4px); right: 0; z-index: 300;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; box-shadow: var(--shadow-md);
    min-width: 195px; padding: 4px;
    animation: pop 0.12s ease;
  }
  @keyframes pop {
    from { opacity: 0; transform: scale(0.94) translateY(-4px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
  }
  .ctx-item {
    width: 100%; display: flex; align-items: center; gap: 9px;
    padding: 8px 10px; border: none; background: none; color: var(--text);
    font-family: var(--font-body); font-size: 13px; cursor: pointer; border-radius: 7px; text-align: left;
    transition: background 0.11s;
  }
  .ctx-item:hover { background: var(--bg); }
  .ctx-item.danger { color: var(--danger); }
  .ctx-item.danger:hover { background: var(--danger-light); }
  .ctx-icon { font-size: 12px; width: 15px; text-align: center; opacity: 0.65; flex-shrink: 0; }

  /* Main */
  .main { flex: 1; padding: 28px 28px 60px; max-width: 820px; overflow-y: auto; }
  .refresh-bar {
    text-align: center; padding: 8px; background: var(--accent-light);
    color: var(--accent); border-radius: 8px; margin-bottom: 16px; font-size: 13px;
  }
  .offline-bar {
    text-align: center; padding: 8px; background: var(--bg);
    border: 1px dashed var(--border);
    color: var(--muted); border-radius: 8px; margin-bottom: 16px; font-size: 13px;
  }
  .conflict-bar {
    text-align: center; padding: 8px; background: var(--danger-light);
    color: var(--danger); border-radius: 8px; margin-bottom: 16px; font-size: 13px;
  }

  .mobile-cats { display: none; gap: 8px; overflow-x: auto; padding-bottom: 4px; margin-bottom: 20px; scrollbar-width: none; }
  .mobile-cats::-webkit-scrollbar { display: none; }
  .mobile-cat {
    display: inline-flex; align-items: center; gap: 5px; padding: 6px 14px;
    border: 1.5px solid var(--border); border-radius: 20px; background: var(--surface);
    color: var(--muted); font-family: var(--font-body); font-size: 13px;
    white-space: nowrap; cursor: pointer; flex-shrink: 0; transition: all 0.13s;
  }
  .mobile-cat.active { border-color: var(--accent); color: var(--accent); background: var(--accent-light); }
  .mobile-cat.fav-tab.active { border-color: var(--fav); color: var(--fav); background: var(--fav-light); }
  .mobile-cat.add-mobile { font-size: 18px; padding: 4px 12px; }

  .page-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 22px; flex-wrap: wrap; gap: 8px; }
  .page-title-row { display: flex; align-items: center; gap: 10px; }
  .fav-icon-big { font-size: 26px; color: var(--fav); line-height: 1; }
  .page-title { font-family: var(--font-head); font-size: 28px; font-weight: 700; color: var(--text); }
  .page-header-right { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
  .task-count { font-size: 13px; color: var(--muted); }
  .fav-hint { font-size: 11.5px; color: var(--fav); background: var(--fav-light); padding: 3px 9px; border-radius: 20px; }

  /* Favourite empty state */
  .fav-empty-state {
    text-align: center; padding: 60px 0; color: var(--muted);
  }
  .fav-empty-star { font-size: 48px; color: var(--fav); opacity: 0.35; margin-bottom: 12px; }
  .fav-empty-state p { font-size: 15px; font-weight: 500; }
  .fav-empty-sub { font-size: 13px; margin-top: 4px; font-weight: 400; }

  .add-form { display: flex; gap: 8px; margin-bottom: 24px; flex-wrap: wrap; }
  .form-input {
    padding: 10px 14px; border: 1.5px solid var(--border); border-radius: 10px;
    background: var(--surface); color: var(--text);
    font-family: var(--font-body); font-size: 14px; outline: none; transition: border-color 0.13s;
  }
  .form-input:focus { border-color: var(--accent); }
  .form-input:first-child { flex: 1; min-width: 150px; }
  .date-input { width: 148px; }
  .form-select {
    padding: 10px 12px; border: 1.5px solid var(--border); border-radius: 10px;
    background: var(--surface); color: var(--text);
    font-family: var(--font-body); font-size: 14px; outline: none; cursor: pointer;
  }
  .btn-add {
    padding: 10px 22px; background: var(--accent); color: white; border: none;
    border-radius: 10px; font-family: var(--font-body); font-size: 14px; font-weight: 500;
    cursor: pointer; transition: opacity 0.13s;
  }
  .btn-add:hover { opacity: 0.87; }

  /* Todo list */
  .todo-list { list-style: none; display: flex; flex-direction: column; gap: 10px; }
  .empty-state { text-align: center; color: var(--muted); padding: 48px 0; font-size: 15px; }

  .todo-card {
    background: var(--surface); border: 1.5px solid var(--border);
    border-radius: var(--radius); overflow: visible; transition: box-shadow 0.15s;
  }
  .todo-card:hover { box-shadow: var(--shadow); }
  .todo-card.done { opacity: 0.6; }
  .todo-card.is-fav { border-color: var(--fav); }

  .todo-top { display: flex; align-items: flex-start; gap: 11px; padding: 13px 12px; }

  .check-btn {
    width: 22px; height: 22px; border-radius: 6px; border: 1.5px solid var(--border);
    background: none; cursor: pointer; display: flex; align-items: center; justify-content: center;
    font-size: 12px; color: white; flex-shrink: 0; margin-top: 2px;
    transition: background 0.13s, border-color 0.13s;
  }
  .check-btn:hover { border-color: var(--accent); }
  .check-btn.checked { background: var(--accent); border-color: var(--accent); }
  .check-btn.small { width: 17px; height: 17px; border-radius: 4px; font-size: 10px; margin-top: 0; }

  .todo-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .todo-title-row { display: flex; align-items: center; gap: 5px; }
  .todo-text { font-size: 15px; line-height: 1.4; flex: 1; word-break: break-word; }
  .todo-text.struck { text-decoration: line-through; color: var(--muted); }
  .expand-arrow { font-size: 14px; color: var(--muted); transition: transform 0.17s; flex-shrink: 0; }
  .expand-arrow.open { transform: rotate(90deg); }

  .todo-meta { display: flex; flex-wrap: wrap; gap: 5px; }
  .meta-tag {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 11px; padding: 2px 8px; border-radius: 20px;
    background: var(--bg); color: var(--muted); font-weight: 500;
  }
  .meta-tag.overdue { background: var(--danger-light); color: var(--danger); }

  /* Star button on card */
  .star-btn {
    border: none; background: none; cursor: pointer; font-size: 18px;
    color: var(--muted); padding: 2px 4px; margin-top: 1px;
    border-radius: 6px; flex-shrink: 0; line-height: 1;
    transition: color 0.15s, transform 0.13s;
  }
  .star-btn:hover { color: var(--fav); transform: scale(1.15); }
  .star-btn.starred { color: var(--fav); }

  .todo-menu-wrap { position: relative; flex-shrink: 0; }

  /* Expanded panel */
  .exp-panel {
    border-top: 1px solid var(--border); background: var(--bg);
    border-radius: 0 0 var(--radius) var(--radius); overflow: hidden;
  }
  .exp-section { padding: 11px 14px; border-bottom: 1px solid var(--border); }
  .exp-section:last-child { border-bottom: none; }
  .exp-label {
    font-size: 10.5px; font-weight: 600; color: var(--muted);
    text-transform: uppercase; letter-spacing: 0.7px; display: block; margin-bottom: 8px;
  }
  .exp-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .exp-chip {
    display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px;
    border-radius: 20px; border: 1.5px solid var(--border); background: none;
    color: var(--muted); font-family: var(--font-body); font-size: 12px;
    cursor: pointer; transition: all 0.12s;
  }
  .exp-chip:hover { border-color: var(--accent); color: var(--accent); }
  .exp-chip.active { font-weight: 600; }
  .exp-chip.dashed { border-style: dashed; }

  /* Favourite toggle in expanded panel */
  .exp-fav-section { }
  .exp-fav-toggle {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 6px 14px; border-radius: 20px; border: 1.5px solid var(--fav);
    background: none; color: var(--fav); font-family: var(--font-body); font-size: 13px;
    cursor: pointer; transition: all 0.13s;
  }
  .exp-fav-toggle:hover { background: var(--fav-light); }
  .exp-fav-toggle.on { background: var(--fav-light); font-weight: 500; }

  /* Subtasks */
  .subtask-list { list-style: none; display: flex; flex-direction: column; gap: 5px; margin-bottom: 8px; }
  .sub-empty { font-size: 12px; color: var(--muted); font-style: italic; }
  .subtask-item { display: flex; align-items: center; gap: 8px; }
  .subtask-text { flex: 1; font-size: 13px; color: var(--muted); }
  .subtask-text.struck { text-decoration: line-through; }
  .reminder-item { display: flex; align-items: center; gap: 8px; }
  .reminder-when {
    font-size: 11.5px; color: var(--muted); background: var(--surface);
    border: 1px solid var(--border); border-radius: 20px; padding: 2px 8px;
    flex-shrink: 0; white-space: nowrap;
  }
  .reminder-msg-input {
    flex: 1; min-width: 0; font-size: 12.5px; padding: 6px 9px;
    border: 1px solid var(--border); border-radius: 8px; background: var(--surface);
    color: var(--text); font-family: var(--font-body); outline: none;
  }
  .reminder-msg-input:focus { border-color: var(--accent); }
  .reminder-days-input { width: 90px; flex-shrink: 0; }
  .subtask-add { display: flex; gap: 6px; }
  .btn-sub-add:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-sub-add:disabled:hover { background: none; color: var(--accent); }
  .subtask-input { flex: 1; font-size: 13px; padding: 7px 10px; }
  .btn-sub-add {
    width: 34px; height: 34px; border: 1.5px solid var(--accent); background: none;
    color: var(--accent); border-radius: 8px; font-size: 18px; cursor: pointer;
    display: flex; align-items: center; justify-content: center; transition: all 0.13s;
  }
  .btn-sub-add:hover { background: var(--accent); color: white; }

  .icon-btn {
    width: 26px; height: 26px; border: 1px solid var(--border); border-radius: 6px;
    background: none; color: var(--muted); font-size: 12px; cursor: pointer;
    display: flex; align-items: center; justify-content: center; transition: all 0.13s;
  }
  .icon-btn.danger:hover { background: var(--danger-light); color: var(--danger); border-color: var(--danger); }
  .icon-btn.sm { width: 20px; height: 20px; font-size: 10px; }

  /* Edit form */
  .edit-form { display: flex; flex-direction: column; gap: 6px; }
  .edit-input, .edit-select {
    padding: 7px 10px; border: 1.5px solid var(--border); border-radius: 8px;
    background: var(--bg); color: var(--text); font-family: var(--font-body); font-size: 13px; outline: none;
  }
  .edit-input:focus { border-color: var(--accent); }
  .edit-actions { display: flex; gap: 6px; }
  .btn-save {
    padding: 5px 14px; background: var(--accent); color: white; border: none;
    border-radius: 7px; font-family: var(--font-body); font-size: 13px; cursor: pointer;
  }
  .btn-ghost-sm {
    padding: 5px 10px; background: none; border: 1px solid var(--border);
    border-radius: 7px; color: var(--muted); font-family: var(--font-body); font-size: 13px; cursor: pointer;
  }

  /* Modal */
  .modal-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.35);
    display: flex; align-items: center; justify-content: center; z-index: 400; backdrop-filter: blur(3px);
  }
  .modal-box {
    background: var(--surface); border: 1px solid var(--border); border-radius: 18px;
    padding: 28px; width: 340px; max-width: 92vw; box-shadow: 0 20px 60px rgba(0,0,0,0.15);
  }
  .modal-title { font-family: var(--font-head); font-size: 18px; font-weight: 700; margin-bottom: 16px; color: var(--text); }
  .modal-desc { font-size: 13.5px; color: var(--muted); margin: -8px 0 16px; }
  .settings-row {
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px; font-size: 14px; color: var(--text); margin-bottom: 6px; cursor: pointer;
  }
  .conflict-list { display: flex; flex-direction: column; gap: 14px; max-height: 50vh; overflow-y: auto; margin-bottom: 4px; }
  .conflict-item { border: 1px solid var(--border); border-radius: 10px; padding: 12px; }
  .conflict-item-title { font-size: 13.5px; font-weight: 600; margin-bottom: 6px; }
  .conflict-item-versions { display: flex; flex-direction: column; gap: 2px; font-size: 12.5px; color: var(--muted); margin-bottom: 8px; }
  .conflict-item .modal-actions { justify-content: flex-end; margin: 0; }
  .modal-input {
    width: 100%; padding: 10px 14px; border: 1.5px solid var(--border); border-radius: 10px;
    background: var(--bg); color: var(--text); font-family: var(--font-body); font-size: 15px; outline: none; margin-bottom: 14px;
  }
  .modal-input:focus { border-color: var(--accent); }
  .color-row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
  .color-swatch {
    width: 28px; height: 28px; border-radius: 50%; border: 2.5px solid transparent;
    cursor: pointer; transition: transform 0.13s;
  }
  .color-swatch.active { border-color: var(--text); transform: scale(1.15); }
  .modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
  .modal-actions-col { flex-direction: column; }
  .btn-ghost {
    padding: 9px 18px; background: none; border: 1px solid var(--border);
    border-radius: 9px; color: var(--muted); font-family: var(--font-body); font-size: 14px; cursor: pointer;
  }
  .btn-primary {
    padding: 9px 22px; background: var(--accent); color: white; border: none;
    border-radius: 9px; font-family: var(--font-body); font-size: 14px; font-weight: 500; cursor: pointer;
  }
  .btn-danger {
    padding: 9px 22px; background: var(--danger); color: white; border: none;
    border-radius: 9px; font-family: var(--font-body); font-size: 14px; font-weight: 500; cursor: pointer;
    transition: opacity 0.13s;
  }
  .btn-danger:hover { opacity: 0.87; }
    .tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 18px;
}

.tab {
  padding: 6px 14px;
  border-radius: 20px;
  border: 1.5px solid var(--border);
  background: var(--surface);
  color: var(--muted);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}

.tab:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.tab.active {
  background: var(--accent-light);
  color: var(--accent);
  border-color: var(--accent);
}


/* Floating Action Button */
.fab {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: none;
  background: var(--accent);
  color: white;
  font-size: 28px;
  cursor: pointer;
  box-shadow: 0 6px 20px rgba(0,0,0,0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 500;
  transition: transform 0.15s, box-shadow 0.15s;
}

.fab:hover {
  transform: scale(1.08);
  box-shadow: 0 10px 28px rgba(0,0,0,0.25);
}

  /* Mobile */
  @media (max-width: 768px) {
    .sidebar { display: none; }
    .mobile-cats { display: flex; }
    .main { padding: 18px 16px 80px; }
    .add-form { flex-direction: column; }
    .form-input, .date-input, .form-select, .btn-add { width: 100%; }
    .date-input { width: 100%; }
    .page-title { font-size: 22px; }
  }
`;
