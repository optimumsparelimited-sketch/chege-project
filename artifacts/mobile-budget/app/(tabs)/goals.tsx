import React, { useState, useCallback, useRef, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Platform,
  Modal,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
  Alert,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useColors } from '@/hooks/useColors';
import { deriveContributorTotals, applyDateFilter, MANUAL_ADJUSTMENT_NOTE } from '@/utils/contributorTotals';
import {
  useGetSavingsGoals,
  useCreateSavingsGoal,
  useUpdateSavingsGoal,
  useDeleteSavingsGoal,
  useContributeToSavingsGoal,
  useCascadeContribute,
  useGetSavingsGoalContributions,
  getGetSavingsGoalContributionsQueryKey,
  getGetSavingsGoalsQueryKey,
  type SavingsGoalContribution,
} from '@workspace/api-client-react';

function formatKES(n?: number | null): string {
  if (n === undefined || n === null) return '—';
  return n.toLocaleString('en-KE', { maximumFractionDigits: 0 });
}

function formatDate(s?: string | null): string {
  if (!s) return '';
  const d = new Date(s);
  return d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}

function dateToYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function ymdToDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}

function formatDateObj(d: Date | null): string {
  if (!d) return '';
  return d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── DeadlinePicker ────────────────────────────────────────────────────────────
type DeadlinePickerProps = {
  value: Date | null;
  onChange: (date: Date | null) => void;
  colors: ReturnType<typeof useColors>;
};

function DeadlinePicker({ value, onChange, colors }: DeadlinePickerProps) {
  const [showNativePicker, setShowNativePicker] = useState(false);
  const webInputRef = useRef<HTMLInputElement | null>(null);

  const displayText = value ? formatDateObj(value) : 'No deadline';
  const hasValue = value !== null;

  const handleNativeChange = (_event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setShowNativePicker(false);
    if (selected) onChange(selected);
  };

  const handleClear = () => {
    onChange(null);
    if (Platform.OS === 'android') setShowNativePicker(false);
  };

  if (Platform.OS === 'web') {
    // On web: a styled button overlaid with a transparent <input type="date">
    return (
      <View
        style={[
          deadlineStyles.row,
          {
            backgroundColor: colors.muted,
            borderColor: colors.border,
            borderRadius: colors.radius,
          },
        ]}
      >
        <Feather name="calendar" size={16} color={hasValue ? colors.foreground : colors.mutedForeground} style={{ marginRight: 8 }} />
        <Text style={[deadlineStyles.valueText, { color: hasValue ? colors.foreground : colors.mutedForeground, flex: 1 }]}>
          {displayText}
        </Text>
        {hasValue && (
          <TouchableOpacity onPress={handleClear} hitSlop={8}>
            <Feather name="x" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        )}
        {/* Transparent date input overlaid on top */}
        {/* @ts-ignore – web-only DOM element */}
        <input
          ref={webInputRef}
          type="date"
          value={value ? dateToYMD(value) : ''}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            const v = e.target.value;
            onChange(v ? ymdToDate(v) : null);
          }}
          style={{
            position: 'absolute',
            inset: 0,
            opacity: 0,
            cursor: 'pointer',
            width: '100%',
            height: '100%',
          }}
        />
      </View>
    );
  }

  // Native (iOS / Android)
  return (
    <>
      <View
        style={[
          deadlineStyles.row,
          {
            backgroundColor: colors.muted,
            borderColor: colors.border,
            borderRadius: colors.radius,
          },
        ]}
      >
        <TouchableOpacity
          style={deadlineStyles.nativeBtn}
          onPress={() => setShowNativePicker(true)}
          activeOpacity={0.7}
        >
          <Feather name="calendar" size={16} color={hasValue ? colors.foreground : colors.mutedForeground} style={{ marginRight: 8 }} />
          <Text style={[deadlineStyles.valueText, { color: hasValue ? colors.foreground : colors.mutedForeground, flex: 1 }]}>
            {displayText}
          </Text>
        </TouchableOpacity>
        {hasValue && (
          <TouchableOpacity onPress={handleClear} hitSlop={8} style={{ paddingRight: 14 }}>
            <Feather name="x" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        )}
      </View>

      {showNativePicker && (
        <>
          {Platform.OS === 'ios' ? (
            <Modal transparent animationType="slide" visible>
              <View style={deadlineStyles.iosOverlay}>
                <View style={[deadlineStyles.iosSheet, { backgroundColor: colors.background }]}>
                  <View style={[deadlineStyles.iosSheetHeader, { borderBottomColor: colors.border }]}>
                    <TouchableOpacity onPress={() => { setShowNativePicker(false); onChange(null); }}>
                      <Text style={[deadlineStyles.iosCancelText, { color: colors.mutedForeground }]}>Clear</Text>
                    </TouchableOpacity>
                    <Text style={[deadlineStyles.iosSheetTitle, { color: colors.foreground }]}>Select Deadline</Text>
                    <TouchableOpacity onPress={() => setShowNativePicker(false)}>
                      <Text style={[deadlineStyles.iosDoneText, { color: colors.primary as string }]}>Done</Text>
                    </TouchableOpacity>
                  </View>
                  <DateTimePicker
                    value={value ?? new Date()}
                    mode="date"
                    display="spinner"
                    onChange={handleNativeChange}
                    style={{ width: '100%' }}
                  />
                </View>
              </View>
            </Modal>
          ) : (
            <DateTimePicker
              value={value ?? new Date()}
              mode="date"
              display="default"
              onChange={handleNativeChange}
            />
          )}
        </>
      )}
    </>
  );
}

const deadlineStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    minHeight: 48,
    overflow: 'hidden',
  },
  nativeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  valueText: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
  },
  iosOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  iosSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 30,
  },
  iosSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  iosSheetTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    fontFamily: 'Inter_600SemiBold',
  },
  iosCancelText: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
  },
  iosDoneText: {
    fontSize: 15,
    fontWeight: '600' as const,
    fontFamily: 'Inter_600SemiBold',
  },
});

type SavingsGoal = {
  id: number;
  name: string;
  targetAmount: number;
  currentAmount: number;
  deadline?: string | null;
  isCompleted: boolean;
};

export default function GoalsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const queryClient = useQueryClient();

  const { data: goals = [], isLoading, refetch } = useGetSavingsGoals();

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  // ── New Goal modal ──────────────────────────────────────────────────────────
  const [newGoalVisible, setNewGoalVisible] = useState(false);
  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalDeadlineDate, setGoalDeadlineDate] = useState<Date | null>(null);
  const [submittingGoal, setSubmittingGoal] = useState(false);

  const { mutateAsync: createGoal } = useCreateSavingsGoal();

  const openNewGoal = () => {
    setGoalName('');
    setGoalTarget('');
    setGoalDeadlineDate(null);
    setNewGoalVisible(true);
  };

  const closeNewGoal = () => {
    if (submittingGoal) return;
    setNewGoalVisible(false);
  };

  const handleCreateGoal = async () => {
    const target = parseFloat(goalTarget.replace(/,/g, ''));
    if (!goalName.trim()) {
      Alert.alert('Name required', 'Please enter a name for the goal.');
      return;
    }
    if (!target || target <= 0) {
      Alert.alert('Target required', 'Please enter a valid target amount.');
      return;
    }
    const deadlineValue = goalDeadlineDate ? dateToYMD(goalDeadlineDate) : undefined;

    setSubmittingGoal(true);
    try {
      await createGoal({
        data: {
          name: goalName.trim(),
          targetAmount: target,
          deadline: deadlineValue,
        },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: getGetSavingsGoalsQueryKey() });
      setNewGoalVisible(false);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', 'Failed to create goal. Please try again.');
    } finally {
      setSubmittingGoal(false);
    }
  };

  // ── Edit Goal modal ─────────────────────────────────────────────────────────
  const [editGoalVisible, setEditGoalVisible] = useState(false);
  const [editingGoal, setEditingGoal] = useState<SavingsGoal | null>(null);
  const [editName, setEditName] = useState('');
  const [editTarget, setEditTarget] = useState('');
  const [editCurrentAmount, setEditCurrentAmount] = useState('');
  const [editCorrectionReason, setEditCorrectionReason] = useState('');
  const [editDeadlineDate, setEditDeadlineDate] = useState<Date | null>(null);
  const [submittingEdit, setSubmittingEdit] = useState(false);

  const { mutateAsync: updateGoal } = useUpdateSavingsGoal();
  const { mutateAsync: deleteGoal } = useDeleteSavingsGoal();

  const openEditGoal = (goal: SavingsGoal) => {
    setEditingGoal(goal);
    setEditName(goal.name);
    setEditTarget(String(goal.targetAmount));
    setEditCurrentAmount(String(goal.currentAmount));
    setEditCorrectionReason('');
    setEditDeadlineDate(ymdToDate(goal.deadline));
    setEditGoalVisible(true);
  };

  const closeEditGoal = () => {
    if (submittingEdit) return;
    setEditGoalVisible(false);
  };

  // Derived: big-drop warning
  const editParsedCurrent = editCurrentAmount !== '' ? parseFloat(editCurrentAmount.replace(/,/g, '')) : NaN;
  const editIsBigDrop =
    editingGoal !== null &&
    !isNaN(editParsedCurrent) &&
    editingGoal.currentAmount > 0 &&
    editParsedCurrent < editingGoal.currentAmount &&
    editingGoal.currentAmount - editParsedCurrent > editingGoal.currentAmount * 0.5;
  const editDropAmount = editingGoal ? editingGoal.currentAmount - editParsedCurrent : 0;

  const handleUpdateGoal = async () => {
    if (!editingGoal) return;
    const target = parseFloat(editTarget.replace(/,/g, ''));
    if (!editName.trim()) {
      Alert.alert('Name required', 'Please enter a name for the goal.');
      return;
    }
    if (!target || target <= 0) {
      Alert.alert('Target required', 'Please enter a valid target amount.');
      return;
    }
    if (editIsBigDrop && !editCorrectionReason.trim()) {
      Alert.alert('Reason required', 'Please explain why the balance is being reduced by more than 50%.');
      return;
    }
    const deadlineValue = editDeadlineDate ? dateToYMD(editDeadlineDate) : null;
    const currentAmountChanged = !isNaN(editParsedCurrent) && editParsedCurrent !== editingGoal.currentAmount;

    setSubmittingEdit(true);
    try {
      await updateGoal({
        id: editingGoal.id,
        data: {
          name: editName.trim(),
          targetAmount: target,
          deadline: deadlineValue,
          ...(currentAmountChanged ? { currentAmount: editParsedCurrent } : {}),
          ...(currentAmountChanged && editCorrectionReason.trim() ? { reason: editCorrectionReason.trim() } : {}),
        },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: getGetSavingsGoalsQueryKey() });
      setEditGoalVisible(false);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', 'Failed to update goal. Please try again.');
    } finally {
      setSubmittingEdit(false);
    }
  };

  const confirmDeleteGoal = (goal: SavingsGoal) => {
    Alert.alert(
      'Delete Goal',
      `Are you sure you want to delete "${goal.name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteGoal({ id: goal.id });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              queryClient.invalidateQueries({ queryKey: getGetSavingsGoalsQueryKey() });
            } catch {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              Alert.alert('Error', 'Failed to delete goal. Please try again.');
            }
          },
        },
      ],
    );
  };

  const openGoalActions = (goal: SavingsGoal) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(goal.name, undefined, [
      { text: 'History', onPress: () => openHistory(goal) },
      { text: 'Edit', onPress: () => openEditGoal(goal) },
      { text: 'Delete', style: 'destructive', onPress: () => confirmDeleteGoal(goal) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // ── Rename completed goal ────────────────────────────────────────────────────
  const [renameVisible, setRenameVisible] = useState(false);
  const [renamingGoal, setRenamingGoal] = useState<SavingsGoal | null>(null);
  const [renameName, setRenameName] = useState('');
  const [submittingRename, setSubmittingRename] = useState(false);

  const openRenameGoal = (goal: SavingsGoal) => {
    setRenamingGoal(goal);
    setRenameName(goal.name);
    setRenameVisible(true);
  };

  const closeRenameGoal = () => {
    if (submittingRename) return;
    setRenameVisible(false);
  };

  const handleRenameGoal = async () => {
    if (!renamingGoal) return;
    if (!renameName.trim()) {
      Alert.alert('Name required', 'Please enter a name for the goal.');
      return;
    }
    setSubmittingRename(true);
    try {
      await updateGoal({
        id: renamingGoal.id,
        data: {
          name: renameName.trim(),
          targetAmount: renamingGoal.targetAmount,
          deadline: renamingGoal.deadline ?? null,
        },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: getGetSavingsGoalsQueryKey() });
      setRenameVisible(false);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', 'Failed to rename goal. Please try again.');
    } finally {
      setSubmittingRename(false);
    }
  };

  const openCompletedGoalActions = (goal: SavingsGoal) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(goal.name, undefined, [
      { text: 'History', onPress: () => openHistory(goal) },
      { text: 'Rename', onPress: () => openRenameGoal(goal) },
      { text: 'Delete', style: 'destructive', onPress: () => confirmDeleteGoal(goal) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // ── History modal ───────────────────────────────────────────────────────────
  const [historyGoal, setHistoryGoal] = useState<SavingsGoal | null>(null);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [filterStart, setFilterStart] = useState<Date | null>(null);
  const [filterEnd, setFilterEnd] = useState<Date | null>(null);
  const [activeChip, setActiveChip] = useState<string | null>(null);
  const [filterContributor, setFilterContributor] = useState<string | null>(null);
  const [historyMonthPickerVisible, setHistoryMonthPickerVisible] = useState(false);

  // Last 24 months for the month-jump picker
  const historyMonthOptions = useMemo(() => {
    const MONTHS_HIST = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const result: { month: number; year: number; label: string }[] = [];
    const d = new Date();
    d.setDate(1);
    for (let i = 0; i < 24; i++) {
      result.push({ month: d.getMonth() + 1, year: d.getFullYear(), label: `${MONTHS_HIST[d.getMonth()]} ${d.getFullYear()}` });
      d.setMonth(d.getMonth() - 1);
    }
    return result;
  }, []);

  function jumpHistoryToMonth(m: number, y: number) {
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0, 23, 59, 59);
    setFilterStart(start);
    setFilterEnd(end);
    setActiveChip(null);
    setHistoryMonthPickerVisible(false);
  }

  // Persist per-goal filter state within a session and across restarts
  type GoalFilterState = { filterStart: Date | null; filterEnd: Date | null; activeChip: string | null; filterContributor: string | null };
  type StoredGoalFilter = { filterStart: string | null; filterEnd: string | null; activeChip: string | null; filterContributor: string | null };
  const goalFilterCache = useRef<Record<number, GoalFilterState>>({});
  const goalFilterStorageKey = (id: number) => `goal_filter_${id}`;

  const { data: contributions = [], isLoading: historyLoading, refetch: refetchHistory } = useGetSavingsGoalContributions(
    historyGoal?.id ?? 0,
    {
      query: {
        queryKey: getGetSavingsGoalContributionsQueryKey(historyGoal?.id ?? 0),
        enabled: historyVisible && !!historyGoal,
      },
    }
  );

  const QUICK_CHIPS: { key: string; label: string }[] = [
    { key: 'this_month', label: 'This Month' },
    { key: 'last_month', label: 'Last Month' },
    { key: 'last_3_months', label: 'Last 3 Months' },
    { key: 'this_year', label: 'This Year' },
  ];

  const getChipRange = (key: string): { start: Date; end: Date } => {
    const now = new Date();
    if (key === 'this_month') {
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1),
        end: new Date(now.getFullYear(), now.getMonth() + 1, 0),
      };
    }
    if (key === 'last_month') {
      return {
        start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        end: new Date(now.getFullYear(), now.getMonth(), 0),
      };
    }
    if (key === 'last_3_months') {
      return {
        start: new Date(now.getFullYear(), now.getMonth() - 2, 1),
        end: new Date(now.getFullYear(), now.getMonth() + 1, 0),
      };
    }
    // this_year
    return {
      start: new Date(now.getFullYear(), 0, 1),
      end: new Date(now.getFullYear(), 11, 31),
    };
  };

  const handleChipPress = (key: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (activeChip === key) {
      setActiveChip(null);
      setFilterStart(null);
      setFilterEnd(null);
    } else {
      const range = getChipRange(key);
      setActiveChip(key);
      setFilterStart(range.start);
      setFilterEnd(range.end);
    }
  };

  const openHistory = async (goal: SavingsGoal) => {
    setHistoryGoal(goal);
    // Restore from in-memory cache first (same session), then fall back to AsyncStorage
    const cached = goalFilterCache.current[goal.id] ?? null;
    if (cached) {
      setFilterStart(cached.filterStart);
      setFilterEnd(cached.filterEnd);
      setActiveChip(cached.activeChip);
      setFilterContributor(cached.filterContributor);
    } else {
      try {
        const raw = await AsyncStorage.getItem(goalFilterStorageKey(goal.id));
        if (raw) {
          const stored: StoredGoalFilter = JSON.parse(raw);
          setFilterStart(stored.filterStart ? new Date(stored.filterStart) : null);
          setFilterEnd(stored.filterEnd ? new Date(stored.filterEnd) : null);
          setActiveChip(stored.activeChip ?? null);
          setFilterContributor(stored.filterContributor ?? null);
        } else {
          setFilterStart(null);
          setFilterEnd(null);
          setActiveChip(null);
          setFilterContributor(null);
        }
      } catch {
        setFilterStart(null);
        setFilterEnd(null);
        setActiveChip(null);
        setFilterContributor(null);
      }
    }
    setHistoryVisible(true);
  };

  const closeHistory = () => {
    // Persist the current filter state for this goal before closing
    if (historyGoal) {
      const state: GoalFilterState = { filterStart, filterEnd, activeChip, filterContributor };
      goalFilterCache.current[historyGoal.id] = state;
      // Write to AsyncStorage so it survives app restarts
      const stored: StoredGoalFilter = {
        filterStart: filterStart ? filterStart.toISOString() : null,
        filterEnd: filterEnd ? filterEnd.toISOString() : null,
        activeChip,
        filterContributor,
      };
      AsyncStorage.setItem(goalFilterStorageKey(historyGoal.id), JSON.stringify(stored)).catch(() => {});
    }
    setHistoryVisible(false);
  };

  // ── Contribute modal ────────────────────────────────────────────────────────
  const [contributeVisible, setContributeVisible] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState<SavingsGoal | null>(null);
  const [contributeAmount, setContributeAmount] = useState('');
  const [submittingContrib, setSubmittingContrib] = useState(false);

  const { mutateAsync: contribute } = useContributeToSavingsGoal();

  // ── Cascade (distribute) modal ───────────────────────────────────────────────
  const [cascadeVisible, setCascadeVisible] = useState(false);
  const [cascadeAmount, setCascadeAmount] = useState('');
  const [cascadeOrder, setCascadeOrder] = useState<number[]>([]);
  const [cascadeResult, setCascadeResult] = useState<Array<{ goalId: number; allocated: number; completed: boolean }> | null>(null);
  const [submittingCascade, setSubmittingCascade] = useState(false);

  const { mutateAsync: cascadeContribute } = useCascadeContribute();

  const openCascade = () => {
    setCascadeOrder(active.map((g) => g.id));
    setCascadeAmount('');
    setCascadeResult(null);
    setCascadeVisible(true);
  };

  const closeCascade = () => {
    if (submittingCascade) return;
    setCascadeVisible(false);
  };

  const moveCascadeGoal = (index: number, dir: 'up' | 'down') => {
    setCascadeOrder((prev) => {
      const next = [...prev];
      const swap = dir === 'up' ? index - 1 : index + 1;
      if (swap < 0 || swap >= next.length) return prev;
      [next[index], next[swap]] = [next[swap], next[index]];
      return next;
    });
  };

  const handleCascade = async () => {
    const amount = parseFloat(cascadeAmount.replace(/,/g, ''));
    if (!amount || amount <= 0) {
      Alert.alert('Invalid amount', 'Please enter a valid amount greater than zero.');
      return;
    }
    setSubmittingCascade(true);
    try {
      const result = await cascadeContribute({ data: { amount, goalIds: cascadeOrder } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: getGetSavingsGoalsQueryKey() });
      setCascadeResult(result.allocations ?? []);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', 'Failed to distribute payment. Please try again.');
    } finally {
      setSubmittingCascade(false);
    }
  };

  const openContribute = (goal: SavingsGoal) => {
    setSelectedGoal(goal);
    setContributeAmount('');
    setContributeVisible(true);
  };

  const closeContribute = () => {
    if (submittingContrib) return;
    setContributeVisible(false);
  };

  const handleContribute = async () => {
    if (!selectedGoal) return;
    const amount = parseFloat(contributeAmount.replace(/,/g, ''));
    if (!amount || amount <= 0) {
      Alert.alert('Invalid amount', 'Please enter a valid amount greater than zero.');
      return;
    }

    setSubmittingContrib(true);
    try {
      await contribute({ id: selectedGoal.id, data: { amount } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: getGetSavingsGoalsQueryKey() });
      setContributeVisible(false);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', 'Failed to record contribution. Please try again.');
    } finally {
      setSubmittingContrib(false);
    }
  };

  // ── Derived data ────────────────────────────────────────────────────────────
  const active = (goals as SavingsGoal[]).filter((g) => !g.isCompleted);
  const done = (goals as SavingsGoal[]).filter((g) => g.isCompleted);

  // Unique contributors derived from loaded data (excluding manual adjustments)
  const uniqueContributors = Array.from(
    new Set(
      (contributions as SavingsGoalContribution[])
        .filter((c) => c.note !== MANUAL_ADJUSTMENT_NOTE)
        .map((c) => c.contributorName ?? 'Unknown')
    )
  );
  const showContributorFilter = uniqueContributors.length > 1;

  // Date-only filtered (no contributor filter) — used for the per-person summary strip
  // so that selecting a contributor in the list doesn't zero out everyone else's total.
  const dateFilteredContributions = applyDateFilter(
    contributions as SavingsGoalContribution[],
    filterStart,
    filterEnd,
  );

  const filteredContributions = dateFilteredContributions.filter((c) => {
    if (filterContributor) {
      // Manual adjustments don't belong to any single contributor — hide them
      // when filtering by person so the count and total are accurate.
      if (c.note === MANUAL_ADJUSTMENT_NOTE) return false;
      if ((c.contributorName ?? 'Unknown') !== filterContributor) return false;
    }
    return true;
  });
  const filterActive = !!(filterStart || filterEnd || filterContributor);
  const filterNetTotal = filteredContributions.reduce((sum, c) => sum + c.amount, 0);

  // Per-contributor totals for the summary strip — respects date filter only, independent of
  // contributor selection so that all totals remain correct when one person is selected.
  const contributorTotals = deriveContributorTotals(
    contributions as SavingsGoalContribution[],
    filterStart,
    filterEnd,
  );
  const totalSaved = (goals as SavingsGoal[]).reduce((s, g) => s + (g.currentAmount ?? 0), 0);
  const totalTarget = (goals as SavingsGoal[]).reduce((s, g) => s + (g.targetAmount ?? 0), 0);

  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.secondary} />
        }
        contentContainerStyle={{ paddingBottom: Platform.OS === 'web' ? 100 : insets.bottom + 110 }}
      >
        {/* Header */}
        <LinearGradient
          colors={['#0a1a10', '#0f2217', '#132a1c']}
          style={[styles.header, { paddingTop: topPad + 16 }]}
        >
          <View style={styles.headerTop}>
            <Text style={styles.headerTitle}>Savings Goals</Text>
            <TouchableOpacity style={styles.newGoalBtn} onPress={openNewGoal} activeOpacity={0.8}>
              <Feather name="plus" size={16} color="#0a1a10" />
              <Text style={styles.newGoalBtnText}>New Goal</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.headerStats}>
            <View style={styles.headerStat}>
              <Text style={styles.headerStatLabel}>Saved</Text>
              <Text style={styles.headerStatValue}>KES {formatKES(totalSaved)}</Text>
            </View>
            <View style={styles.headerDivider} />
            <View style={styles.headerStat}>
              <Text style={styles.headerStatLabel}>Target</Text>
              <Text style={styles.headerStatValue}>KES {formatKES(totalTarget)}</Text>
            </View>
            <View style={styles.headerDivider} />
            <View style={styles.headerStat}>
              <Text style={styles.headerStatLabel}>Goals</Text>
              <Text style={styles.headerStatValue}>{goals.length}</Text>
            </View>
          </View>
        </LinearGradient>

        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} size="large" />
        ) : goals.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="target" size={40} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No savings goals yet</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Tap "New Goal" to create your first goal
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {active.length > 0 && (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginBottom: 0 }]}>ACTIVE</Text>
                  {active.length > 1 && (
                    <Pressable
                      onPress={openCascade}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        backgroundColor: '#1a3320',
                        borderRadius: 20,
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <Feather name="share-2" size={13} color="#4ade80" />
                      <Text style={{ color: '#4ade80', fontSize: 12, fontFamily: 'Inter_600SemiBold' }}>Distribute</Text>
                    </Pressable>
                  )}
                </View>
                {active.map((goal) => {
                  const pct = goal.targetAmount > 0 ? Math.min(goal.currentAmount / goal.targetAmount, 1) : 0;
                  const isFunded = goal.targetAmount > 0 && goal.currentAmount >= goal.targetAmount;
                  return (
                    <Pressable
                      key={goal.id}
                      onLongPress={() => openGoalActions(goal)}
                      delayLongPress={400}
                      style={[styles.card, { backgroundColor: colors.card, borderColor: isFunded ? '#4ade80' : colors.border }]}
                    >
                      <View style={styles.cardTop}>
                        <View style={[styles.iconCircle, { backgroundColor: '#1a3320' }]}>
                          <Feather name="target" size={18} color="#4ade80" />
                        </View>
                        <View style={styles.cardInfo}>
                          <Text style={[styles.cardName, { color: colors.foreground }]}>{goal.name}</Text>
                          {goal.deadline ? (
                            <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>
                              Due {formatDate(goal.deadline)}
                            </Text>
                          ) : null}
                        </View>
                        <View style={styles.cardRight}>
                          <Text style={[styles.cardPct, { color: '#4ade80' }]}>{Math.round(pct * 100)}%</Text>
                          <TouchableOpacity
                            onPress={() => openGoalActions(goal)}
                            hitSlop={8}
                            style={styles.kebabBtn}
                          >
                            <Feather name="more-vertical" size={18} color={colors.mutedForeground} />
                          </TouchableOpacity>
                        </View>
                      </View>

                      {/* Progress bar */}
                      <View style={[styles.barTrack, { backgroundColor: colors.border }]}>
                        <View style={[styles.barFill, { width: `${pct * 100}%`, backgroundColor: '#4ade80' }]} />
                      </View>

                      {isFunded && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1a3320', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 4 }}>
                          <Feather name="check-circle" size={14} color="#4ade80" />
                          <Text style={{ color: '#4ade80', fontSize: 13, fontWeight: '600' }}>Goal reached! Mark it complete.</Text>
                        </View>
                      )}
                      <View style={styles.cardBottom}>
                        <View style={styles.cardAmounts}>
                          <Text style={[styles.cardAmountSaved, { color: colors.foreground }]}>
                            KES {formatKES(goal.currentAmount)} saved
                          </Text>
                          <Text style={[styles.cardAmountTarget, { color: colors.mutedForeground }]}>
                            of KES {formatKES(goal.targetAmount)}
                          </Text>
                        </View>
                        {!isFunded && (
                          <Pressable
                            onPress={() => openContribute(goal)}
                            style={({ pressed }) => [
                              styles.contributeBtn,
                              { backgroundColor: '#1a3320', opacity: pressed ? 0.7 : 1 },
                            ]}
                          >
                            <Feather name="plus-circle" size={13} color="#4ade80" />
                            <Text style={styles.contributeBtnText}>Contribute</Text>
                          </Pressable>
                        )}
                      </View>
                    </Pressable>
                  );
                })}
              </>
            )}

            {done.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 8 }]}>COMPLETED</Text>
                {done.map((goal) => (
                  <Pressable
                    key={goal.id}
                    onLongPress={() => openCompletedGoalActions(goal)}
                    delayLongPress={400}
                    style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, opacity: 0.7 }]}
                  >
                    <View style={styles.cardTop}>
                      <View style={[styles.iconCircle, { backgroundColor: '#1a2e10' }]}>
                        <Feather name="check-circle" size={18} color="#86efac" />
                      </View>
                      <View style={styles.cardInfo}>
                        <Text style={[styles.cardName, { color: colors.foreground }]}>{goal.name}</Text>
                        <Text style={[styles.cardSub, { color: '#4ade80' }]}>Goal reached!</Text>
                      </View>
                      <View style={styles.cardRight}>
                        <Text style={[styles.cardPct, { color: '#86efac' }]}>
                          KES {formatKES(goal.currentAmount)}
                        </Text>
                        <TouchableOpacity
                          onPress={() => openCompletedGoalActions(goal)}
                          hitSlop={8}
                          style={styles.kebabBtn}
                        >
                          <Feather name="more-vertical" size={18} color={colors.mutedForeground} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </Pressable>
                ))}
              </>
            )}
          </View>
        )}
      </ScrollView>

      {/* ── New Goal Modal ─────────────────────────────────────────────────── */}
      <Modal
        visible={newGoalVisible}
        animationType="slide"
        transparent
        onRequestClose={closeNewGoal}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={styles.modalAvoid}
            >
              <TouchableWithoutFeedback>
                <View style={[styles.modalSheet, { backgroundColor: colors.background, paddingBottom: botPad + 16 }]}>
                  {/* Handle */}
                  <View style={[styles.handle, { backgroundColor: colors.border }]} />

                  {/* Header */}
                  <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
                    <TouchableOpacity onPress={closeNewGoal} style={styles.modalHeaderBtn}>
                      <Feather name="x" size={22} color={colors.mutedForeground} />
                    </TouchableOpacity>
                    <Text style={[styles.modalTitle, { color: colors.foreground }]}>New Savings Goal</Text>
                    <TouchableOpacity
                      onPress={handleCreateGoal}
                      disabled={submittingGoal}
                      style={[styles.modalSaveBtn, { backgroundColor: colors.primary, opacity: submittingGoal ? 0.7 : 1 }]}
                    >
                      {submittingGoal ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.modalSaveBtnText}>Create</Text>
                      )}
                    </TouchableOpacity>
                  </View>

                  <ScrollView
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={styles.modalBody}
                    showsVerticalScrollIndicator={false}
                  >
                    {/* Goal name */}
                    <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>GOAL NAME</Text>
                    <TextInput
                      style={[styles.textInput, {
                        backgroundColor: colors.muted,
                        borderColor: colors.border,
                        color: colors.foreground,
                        borderRadius: colors.radius,
                      }]}
                      placeholder="e.g. Emergency Fund"
                      placeholderTextColor={colors.mutedForeground}
                      value={goalName}
                      onChangeText={setGoalName}
                      autoFocus
                      returnKeyType="next"
                    />

                    {/* Target amount */}
                    <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>TARGET AMOUNT (KES)</Text>
                    <TextInput
                      style={[styles.textInput, {
                        backgroundColor: colors.muted,
                        borderColor: colors.border,
                        color: colors.foreground,
                        borderRadius: colors.radius,
                      }]}
                      placeholder="e.g. 50000"
                      placeholderTextColor={colors.mutedForeground}
                      keyboardType="numeric"
                      value={goalTarget}
                      onChangeText={setGoalTarget}
                      returnKeyType="next"
                    />

                    {/* Deadline */}
                    <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>DEADLINE (optional)</Text>
                    <DeadlinePicker
                      value={goalDeadlineDate}
                      onChange={setGoalDeadlineDate}
                      colors={colors}
                    />
                  </ScrollView>
                </View>
              </TouchableWithoutFeedback>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* ── Contribute Modal ───────────────────────────────────────────────── */}
      <Modal
        visible={contributeVisible}
        animationType="slide"
        transparent
        onRequestClose={closeContribute}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={styles.modalAvoid}
            >
              <TouchableWithoutFeedback>
                <View style={[styles.modalSheet, { backgroundColor: colors.background, paddingBottom: botPad + 16 }]}>
                  {/* Handle */}
                  <View style={[styles.handle, { backgroundColor: colors.border }]} />

                  {/* Header */}
                  <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
                    <TouchableOpacity onPress={closeContribute} style={styles.modalHeaderBtn}>
                      <Feather name="x" size={22} color={colors.mutedForeground} />
                    </TouchableOpacity>
                    <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                      Contribute
                    </Text>
                    <TouchableOpacity
                      onPress={handleContribute}
                      disabled={submittingContrib}
                      style={[styles.modalSaveBtn, { backgroundColor: colors.primary, opacity: submittingContrib ? 0.7 : 1 }]}
                    >
                      {submittingContrib ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.modalSaveBtnText}>Save</Text>
                      )}
                    </TouchableOpacity>
                  </View>

                  <View style={styles.modalBody}>
                    {/* Goal context pill */}
                    {selectedGoal && (
                      <View style={[styles.goalPill, { backgroundColor: '#1a3320' }]}>
                        <Feather name="target" size={14} color="#4ade80" />
                        <Text style={styles.goalPillText} numberOfLines={1}>
                          {selectedGoal.name}
                        </Text>
                        <Text style={styles.goalPillSub}>
                          KES {formatKES(selectedGoal.currentAmount)} / {formatKES(selectedGoal.targetAmount)}
                        </Text>
                      </View>
                    )}

                    {/* Amount input */}
                    <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>AMOUNT (KES)</Text>
                    <View style={styles.amountRow}>
                      <Text style={[styles.currencyLabel, { color: colors.mutedForeground }]}>KES</Text>
                      <TextInput
                        style={[styles.amountInput, { color: colors.foreground }]}
                        placeholder="0"
                        placeholderTextColor={colors.mutedForeground}
                        keyboardType="numeric"
                        value={contributeAmount}
                        onChangeText={setContributeAmount}
                        autoFocus
                        returnKeyType="done"
                        onSubmitEditing={handleContribute}
                      />
                    </View>
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* ── Cascade / Distribute Modal ─────────────────────────────────────── */}
      <Modal
        visible={cascadeVisible}
        animationType="slide"
        transparent
        onRequestClose={closeCascade}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={styles.modalAvoid}
            >
              <TouchableWithoutFeedback>
                <View style={[styles.modalSheet, { backgroundColor: colors.background, paddingBottom: botPad + 16 }]}>
                  <View style={[styles.handle, { backgroundColor: colors.border }]} />

                  {/* Header */}
                  <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
                    <TouchableOpacity onPress={closeCascade} style={styles.modalHeaderBtn}>
                      <Feather name="x" size={22} color={colors.mutedForeground} />
                    </TouchableOpacity>
                    <Text style={[styles.modalTitle, { color: colors.foreground }]}>Distribute Payment</Text>
                    {!cascadeResult ? (
                      <TouchableOpacity
                        onPress={handleCascade}
                        disabled={submittingCascade}
                        style={[styles.modalSaveBtn, { backgroundColor: colors.primary, opacity: submittingCascade ? 0.7 : 1 }]}
                      >
                        {submittingCascade ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={styles.modalSaveBtnText}>Distribute</Text>
                        )}
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        onPress={closeCascade}
                        style={[styles.modalSaveBtn, { backgroundColor: '#1a3320' }]}
                      >
                        <Text style={[styles.modalSaveBtnText, { color: '#4ade80' }]}>Done</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  <ScrollView
                    style={{ flex: 1 }}
                    contentContainerStyle={styles.modalBody}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                  >
                    {cascadeResult ? (
                      /* Results view */
                      <>
                        <Text style={[styles.fieldLabel, { color: colors.mutedForeground, marginBottom: 12 }]}>DISTRIBUTION RESULT</Text>
                        {cascadeResult.map((alloc) => {
                          const goal = active.find((g) => g.id === alloc.goalId);
                          if (!alloc.allocated) return null;
                          return (
                            <View
                              key={alloc.goalId}
                              style={[styles.cascadeResultRow, { backgroundColor: alloc.completed ? '#1a3320' : colors.card, borderColor: alloc.completed ? '#4ade80' : colors.border }]}
                            >
                              <View style={{ flex: 1 }}>
                                <Text style={[styles.cascadeGoalName, { color: colors.foreground }]} numberOfLines={1}>
                                  {goal?.name ?? `Goal ${alloc.goalId}`}
                                </Text>
                                {alloc.completed && (
                                  <Text style={{ color: '#4ade80', fontSize: 11, fontFamily: 'Inter_500Medium', marginTop: 2 }}>
                                    ✓ Completed!
                                  </Text>
                                )}
                              </View>
                              <Text style={{ color: alloc.completed ? '#4ade80' : colors.primary, fontFamily: 'Inter_700Bold', fontSize: 15 }}>
                                +KES {formatKES(alloc.allocated)}
                              </Text>
                            </View>
                          );
                        })}
                      </>
                    ) : (
                      /* Input view */
                      <>
                        <Text style={[{ color: colors.mutedForeground, fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 16, lineHeight: 18 }]}>
                          Enter a total amount and drag goals into priority order. Funds fill the top goal first, then overflow to the next.
                        </Text>

                        {/* Amount */}
                        <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>TOTAL AMOUNT (KES)</Text>
                        <View style={[styles.amountRow, { marginBottom: 20 }]}>
                          <Text style={[styles.currencyLabel, { color: colors.mutedForeground }]}>KES</Text>
                          <TextInput
                            style={[styles.amountInput, { color: colors.foreground }]}
                            placeholder="0"
                            placeholderTextColor={colors.mutedForeground}
                            keyboardType="numeric"
                            value={cascadeAmount}
                            onChangeText={setCascadeAmount}
                            autoFocus
                            returnKeyType="done"
                            onSubmitEditing={Keyboard.dismiss}
                          />
                        </View>

                        {/* Goal priority order */}
                        <Text style={[styles.fieldLabel, { color: colors.mutedForeground, marginBottom: 8 }]}>GOAL PRIORITY ORDER</Text>
                        {cascadeOrder.map((id, idx) => {
                          const goal = active.find((g) => g.id === id);
                          if (!goal) return null;
                          const remaining = goal.targetAmount - goal.currentAmount;
                          return (
                            <View
                              key={id}
                              style={[styles.cascadeGoalRow, { backgroundColor: colors.card, borderColor: colors.border }]}
                            >
                              <View style={{ width: 24, alignItems: 'center' }}>
                                <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: 'Inter_700Bold' }}>{idx + 1}</Text>
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text style={[styles.cascadeGoalName, { color: colors.foreground }]} numberOfLines={1}>{goal.name}</Text>
                                <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: 'Inter_400Regular' }}>
                                  Needs KES {formatKES(remaining > 0 ? remaining : 0)} more
                                </Text>
                              </View>
                              <View style={{ flexDirection: 'column', gap: 4 }}>
                                <TouchableOpacity
                                  onPress={() => moveCascadeGoal(idx, 'up')}
                                  disabled={idx === 0}
                                  style={{ opacity: idx === 0 ? 0.2 : 1 }}
                                  hitSlop={8}
                                >
                                  <Feather name="chevron-up" size={18} color={colors.mutedForeground} />
                                </TouchableOpacity>
                                <TouchableOpacity
                                  onPress={() => moveCascadeGoal(idx, 'down')}
                                  disabled={idx === cascadeOrder.length - 1}
                                  style={{ opacity: idx === cascadeOrder.length - 1 ? 0.2 : 1 }}
                                  hitSlop={8}
                                >
                                  <Feather name="chevron-down" size={18} color={colors.mutedForeground} />
                                </TouchableOpacity>
                              </View>
                            </View>
                          );
                        })}
                      </>
                    )}
                  </ScrollView>
                </View>
              </TouchableWithoutFeedback>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* ── History Modal ──────────────────────────────────────────────────── */}
      <Modal
        visible={historyVisible}
        animationType="slide"
        transparent
        onRequestClose={closeHistory}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, styles.historySheet, { backgroundColor: colors.background, paddingBottom: botPad + 16 }]}>
            <View style={[styles.handle, { backgroundColor: colors.border }]} />

            {/* Header */}
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <TouchableOpacity onPress={closeHistory} style={styles.modalHeaderBtn}>
                <Feather name="x" size={22} color={colors.mutedForeground} />
              </TouchableOpacity>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={[styles.modalTitle, { color: colors.foreground }]} numberOfLines={1}>
                  {historyGoal?.name}
                </Text>
                <Text style={[styles.historySubtitle, { color: colors.mutedForeground }]}>Contribution history</Text>
              </View>
              <TouchableOpacity
                onPress={() => refetchHistory()}
                style={[styles.modalHeaderBtn, { opacity: historyLoading ? 0.4 : 1 }]}
                disabled={historyLoading}
              >
                <Feather name="refresh-cw" size={18} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            {/* Date range filter bar */}
            {!historyLoading && (contributions as SavingsGoalContribution[]).length > 0 && (
              <View style={[styles.filterBar, { borderBottomColor: colors.border }]}>
                {/* Quick-filter chips */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipsRow}
                  style={styles.chipsScroll}
                >
                  {QUICK_CHIPS.map((chip) => {
                    const isActive = activeChip === chip.key;
                    return (
                      <Pressable
                        key={chip.key}
                        onPress={() => handleChipPress(chip.key)}
                        style={[
                          styles.chip,
                          {
                            backgroundColor: isActive ? colors.primary as string : colors.muted,
                            borderColor: isActive ? colors.primary as string : colors.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            { color: isActive ? '#fff' : colors.mutedForeground },
                          ]}
                        >
                          {chip.label}
                        </Text>
                      </Pressable>
                    );
                  })}

                  {/* Month picker chip */}
                  <Pressable
                    onPress={() => setHistoryMonthPickerVisible(true)}
                    style={[
                      styles.chip,
                      { backgroundColor: colors.muted, borderColor: colors.border, flexDirection: 'row', gap: 4 },
                    ]}
                  >
                    <Feather name="calendar" size={12} color={colors.mutedForeground} />
                    <Text style={[styles.chipText, { color: colors.mutedForeground }]}>Month…</Text>
                  </Pressable>
                </ScrollView>

                {/* FROM / TO pickers */}
                <View style={styles.filterPickers}>
                  <View style={styles.filterField}>
                    <Text style={[styles.filterLabel, { color: colors.mutedForeground }]}>FROM</Text>
                    <DeadlinePicker
                      value={filterStart}
                      onChange={(d) => { setFilterStart(d); setActiveChip(null); }}
                      colors={colors}
                    />
                  </View>
                  <View style={styles.filterDivider} />
                  <View style={styles.filterField}>
                    <Text style={[styles.filterLabel, { color: colors.mutedForeground }]}>TO</Text>
                    <DeadlinePicker
                      value={filterEnd}
                      onChange={(d) => { setFilterEnd(d); setActiveChip(null); }}
                      colors={colors}
                    />
                  </View>
                  {(filterStart || filterEnd) && (
                    <TouchableOpacity
                      onPress={() => { setFilterStart(null); setFilterEnd(null); setActiveChip(null); }}
                      style={styles.filterClearBtn}
                      hitSlop={8}
                    >
                      <Feather name="x-circle" size={16} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Contributor chips — only when multiple contributors exist */}
                {showContributorFilter && (
                  <View style={styles.contributorRow}>
                    <Text style={[styles.filterLabel, { color: colors.mutedForeground, marginBottom: 6 }]}>
                      CONTRIBUTOR
                    </Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.chipsRow}
                    >
                      {uniqueContributors.map((name) => {
                        const isActive = filterContributor === name;
                        return (
                          <Pressable
                            key={name}
                            onPress={() => {
                              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                              setFilterContributor(isActive ? null : name);
                            }}
                            style={[
                              styles.chip,
                              {
                                backgroundColor: isActive ? '#1a3320' : colors.muted,
                                borderColor: isActive ? '#4ade80' : colors.border,
                              },
                            ]}
                          >
                            <Feather
                              name="user"
                              size={12}
                              color={isActive ? '#4ade80' : colors.mutedForeground}
                              style={{ marginRight: 4 }}
                            />
                            <Text
                              style={[
                                styles.chipText,
                                { color: isActive ? '#4ade80' : colors.mutedForeground },
                              ]}
                            >
                              {name}
                            </Text>
                          </Pressable>
                        );
                      })}
                      {filterContributor && (
                        <TouchableOpacity
                          onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            setFilterContributor(null);
                          }}
                          style={[styles.chip, { backgroundColor: colors.muted, borderColor: colors.border }]}
                          hitSlop={4}
                        >
                          <Feather name="x" size={12} color={colors.mutedForeground} style={{ marginRight: 4 }} />
                          <Text style={[styles.chipText, { color: colors.mutedForeground }]}>Clear</Text>
                        </TouchableOpacity>
                      )}
                    </ScrollView>
                  </View>
                )}
              </View>
            )}

            {/* Filter summary bar */}
            {filterActive && !historyLoading && (contributions as SavingsGoalContribution[]).length > 0 && (
              <View style={[styles.filterSummaryBar, { backgroundColor: '#0f2217', borderBottomColor: colors.border }]}>
                <Feather name="bar-chart-2" size={13} color="#4ade80" style={{ marginRight: 6 }} />
                <Text style={[styles.filterSummaryText, { color: '#86efac' }]}>
                  {filteredContributions.length}{' '}
                  {filteredContributions.length === 1 ? 'contribution' : 'contributions'}
                  {filterContributor ? ` by ${filterContributor}` : ''}
                  {'  ·  '}
                  <Text style={{ color: filterNetTotal >= 0 ? '#4ade80' : '#f87171' }}>
                    {filterNetTotal >= 0
                      ? `KES ${formatKES(filterNetTotal)}`
                      : `\u2212 KES ${formatKES(Math.abs(filterNetTotal))}`} total
                  </Text>
                </Text>
              </View>
            )}

            {/* Per-contributor summary strip — shown when multiple contributors exist */}
            {showContributorFilter && !historyLoading && (contributions as SavingsGoalContribution[]).length > 0 && (
              <View style={[styles.contributorSummaryBar, { borderBottomColor: colors.border }]}>
                {contributorTotals.map((ct, idx) => {
                  const isActive = filterContributor === ct.name;
                  return (
                    <React.Fragment key={ct.name}>
                      {idx > 0 && (
                        <View style={[styles.contributorSummaryDivider, { backgroundColor: colors.border }]} />
                      )}
                      <TouchableOpacity
                        style={styles.contributorSummaryItem}
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setFilterContributor(isActive ? null : ct.name);
                        }}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.contributorSummaryName,
                            { color: isActive ? '#4ade80' : colors.mutedForeground },
                          ]}
                        >
                          {ct.name}
                        </Text>
                        <Text
                          style={[
                            styles.contributorSummaryAmount,
                            { color: isActive ? '#4ade80' : colors.foreground },
                          ]}
                        >
                          KES {formatKES(ct.total)}
                        </Text>
                      </TouchableOpacity>
                    </React.Fragment>
                  );
                })}
              </View>
            )}

            {/* Body */}
            {(() => {
              const filtered = filteredContributions;

              if (historyLoading) {
                return <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} size="large" />;
              }
              if ((contributions as SavingsGoalContribution[]).length === 0) {
                return (
                  <View style={styles.historyEmpty}>
                    <Feather name="clock" size={36} color={colors.mutedForeground} />
                    <Text style={[styles.historyEmptyTitle, { color: colors.foreground }]}>No contributions yet</Text>
                    <Text style={[styles.historyEmptyText, { color: colors.mutedForeground }]}>
                      Tap "Contribute" on the goal card to start saving
                    </Text>
                  </View>
                );
              }
              if (filtered.length === 0) {
                return (
                  <View style={styles.historyEmpty}>
                    <Feather name="filter" size={36} color={colors.mutedForeground} />
                    <Text style={[styles.historyEmptyTitle, { color: colors.foreground }]}>No contributions found</Text>
                    <Text style={[styles.historyEmptyText, { color: colors.mutedForeground }]}>
                      {filterContributor
                        ? `No contributions from ${filterContributor} in this range`
                        : 'No contributions fall in the selected date range'}
                    </Text>
                  </View>
                );
              }
              return (
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.historyList}
                >
                  {filtered.map((c, idx) => {
                    const isAdjustment = c.note === 'Manual adjustment';
                    const isNegative = c.amount < 0;
                    const absAmount = Math.abs(c.amount);
                    const amountLabel = isNegative
                      ? `\u2212 KES ${formatKES(absAmount)}`
                      : `+ KES ${formatKES(absAmount)}`;
                    return (
                      <View
                        key={c.id}
                        style={[
                          styles.historyRow,
                          {
                            borderBottomColor: colors.border,
                            borderBottomWidth: idx < filtered.length - 1 ? 1 : 0,
                            opacity: isAdjustment ? 0.8 : 1,
                          },
                        ]}
                      >
                        <View
                          style={[
                            styles.historyDot,
                            {
                              backgroundColor: isAdjustment ? colors.muted : '#1a3320',
                            },
                          ]}
                        >
                          <Feather
                            name={isAdjustment ? 'sliders' : 'arrow-up-circle'}
                            size={16}
                            color={isAdjustment ? colors.mutedForeground : '#4ade80'}
                          />
                        </View>
                        <View style={styles.historyRowInfo}>
                          <View style={styles.historyRowTop}>
                            <Text
                              style={[
                                styles.historyAmount,
                                {
                                  color: isAdjustment
                                    ? isNegative
                                      ? colors.destructive ?? '#ef4444'
                                      : colors.mutedForeground
                                    : colors.foreground,
                                },
                              ]}
                            >
                              {amountLabel}
                            </Text>
                            {isAdjustment ? (
                              <View style={styles.historyAdjustmentBadge}>
                                <Text style={[styles.historyAdjustmentBadgeText, { color: colors.mutedForeground }]}>
                                  Manual
                                </Text>
                              </View>
                            ) : (
                              <Text style={[styles.historyContributor, { color: '#4ade80' }]}>
                                {c.contributorName}
                              </Text>
                            )}
                          </View>
                          <Text style={[styles.historyDate, { color: colors.mutedForeground }]}>
                            {isAdjustment ? 'Balance correction' : formatDate(c.createdAt)}
                          </Text>
                          {isAdjustment && (
                            <Text style={[styles.historyDate, { color: colors.mutedForeground }]}>
                              {formatDate(c.createdAt)}
                            </Text>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* ── History Month-Jump Picker ──────────────────────────────────────── */}
      <Modal
        visible={historyMonthPickerVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setHistoryMonthPickerVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setHistoryMonthPickerVisible(false)}>
          <View style={styles.pickerOverlay}>
            <TouchableWithoutFeedback onPress={() => {}}>
              <View style={[styles.pickerSheet, { backgroundColor: colors.card }]}>
                <View style={[styles.pickerHandle, { backgroundColor: colors.border }]} />
                <Text style={[styles.pickerTitle, { color: colors.foreground }]}>Jump to month</Text>
                <FlatList
                  data={historyMonthOptions}
                  keyExtractor={(item: { month: number; year: number; label: string }) => `${item.year}-${item.month}`}
                  showsVerticalScrollIndicator={false}
                  style={styles.pickerList}
                  renderItem={({ item }: { item: { month: number; year: number; label: string } }) => {
                    const isActive =
                      filterStart &&
                      filterStart.getMonth() + 1 === item.month &&
                      filterStart.getFullYear() === item.year &&
                      !activeChip;
                    return (
                      <Pressable
                        onPress={() => jumpHistoryToMonth(item.month, item.year)}
                        style={[styles.pickerItem, isActive && { backgroundColor: colors.accent }]}
                      >
                        <Text style={[styles.pickerItemText, { color: isActive ? colors.accentForeground : colors.foreground }, isActive && { fontFamily: 'Inter_700Bold' }]}>
                          {item.label}
                        </Text>
                        {isActive && <Feather name="check" size={16} color={colors.accentForeground} />}
                      </Pressable>
                    );
                  }}
                />
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* ── Edit Goal Modal ────────────────────────────────────────────────── */}
      <Modal
        visible={editGoalVisible}
        animationType="slide"
        transparent
        onRequestClose={closeEditGoal}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={styles.modalAvoid}
            >
              <TouchableWithoutFeedback>
                <View style={[styles.modalSheet, { backgroundColor: colors.background, paddingBottom: botPad + 16 }]}>
                  {/* Handle */}
                  <View style={[styles.handle, { backgroundColor: colors.border }]} />

                  {/* Header */}
                  <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
                    <TouchableOpacity onPress={closeEditGoal} style={styles.modalHeaderBtn}>
                      <Feather name="x" size={22} color={colors.mutedForeground} />
                    </TouchableOpacity>
                    <Text style={[styles.modalTitle, { color: colors.foreground }]}>Edit Goal</Text>
                    <TouchableOpacity
                      onPress={handleUpdateGoal}
                      disabled={submittingEdit || (editIsBigDrop && !editCorrectionReason.trim())}
                      style={[styles.modalSaveBtn, { backgroundColor: colors.primary, opacity: (submittingEdit || (editIsBigDrop && !editCorrectionReason.trim())) ? 0.4 : 1 }]}
                    >
                      {submittingEdit ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.modalSaveBtnText}>Save</Text>
                      )}
                    </TouchableOpacity>
                  </View>

                  <ScrollView
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={styles.modalBody}
                    showsVerticalScrollIndicator={false}
                  >
                    {/* Goal name */}
                    <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>GOAL NAME</Text>
                    <TextInput
                      style={[styles.textInput, {
                        backgroundColor: colors.muted,
                        borderColor: colors.border,
                        color: colors.foreground,
                        borderRadius: colors.radius,
                      }]}
                      placeholder="e.g. Emergency Fund"
                      placeholderTextColor={colors.mutedForeground}
                      value={editName}
                      onChangeText={setEditName}
                      autoFocus
                      returnKeyType="next"
                    />

                    {/* Target amount */}
                    <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>TARGET AMOUNT (KES)</Text>
                    <TextInput
                      style={[styles.textInput, {
                        backgroundColor: colors.muted,
                        borderColor: colors.border,
                        color: colors.foreground,
                        borderRadius: colors.radius,
                      }]}
                      placeholder="e.g. 50000"
                      placeholderTextColor={colors.mutedForeground}
                      keyboardType="numeric"
                      value={editTarget}
                      onChangeText={setEditTarget}
                      returnKeyType="next"
                    />

                    {/* Current balance correction */}
                    <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>CURRENT BALANCE (KES)</Text>
                    <TextInput
                      style={[styles.textInput, {
                        backgroundColor: colors.muted,
                        borderColor: colors.border,
                        color: colors.foreground,
                        borderRadius: colors.radius,
                      }]}
                      placeholder="Leave unchanged or enter correction"
                      placeholderTextColor={colors.mutedForeground}
                      keyboardType="numeric"
                      value={editCurrentAmount}
                      onChangeText={(v) => { setEditCurrentAmount(v); setEditCorrectionReason(''); }}
                      returnKeyType="next"
                    />

                    {/* Big-drop warning + required reason */}
                    {editIsBigDrop && (
                      <View style={{
                        backgroundColor: '#fef3c7',
                        borderColor: '#d97706',
                        borderWidth: 1,
                        borderRadius: 12,
                        padding: 14,
                        marginBottom: 8,
                        gap: 8,
                      }}>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#92400e' }}>
                          ⚠ This will remove KES {editDropAmount.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} from this goal
                        </Text>
                        <Text style={{ fontSize: 12, color: '#b45309' }}>
                          That's more than 50% of the current balance. Please explain why so this correction can be traced.
                        </Text>
                        <Text style={[styles.fieldLabel, { color: '#92400e', marginTop: 4 }]}>REASON (required)</Text>
                        <TextInput
                          style={[styles.textInput, {
                            backgroundColor: '#fffbeb',
                            borderColor: '#d97706',
                            color: '#1c1917',
                            borderRadius: 8,
                            marginBottom: 0,
                          }]}
                          placeholder="e.g. Withdrew funds to cover medical bill"
                          placeholderTextColor="#a16207"
                          value={editCorrectionReason}
                          onChangeText={setEditCorrectionReason}
                          returnKeyType="done"
                          multiline
                        />
                      </View>
                    )}

                    {/* Deadline */}
                    <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>DEADLINE (optional)</Text>
                    <DeadlinePicker
                      value={editDeadlineDate}
                      onChange={setEditDeadlineDate}
                      colors={colors}
                    />
                  </ScrollView>
                </View>
              </TouchableWithoutFeedback>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* ── Rename Completed Goal Modal ────────────────────────────────────── */}
      <Modal
        visible={renameVisible}
        animationType="slide"
        transparent
        onRequestClose={closeRenameGoal}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={styles.modalAvoid}
            >
              <TouchableWithoutFeedback>
                <View style={[styles.modalSheet, { backgroundColor: colors.background, paddingBottom: botPad + 16 }]}>
                  {/* Handle */}
                  <View style={[styles.handle, { backgroundColor: colors.border }]} />

                  {/* Header */}
                  <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
                    <TouchableOpacity onPress={closeRenameGoal} style={styles.modalHeaderBtn}>
                      <Feather name="x" size={22} color={colors.mutedForeground} />
                    </TouchableOpacity>
                    <Text style={[styles.modalTitle, { color: colors.foreground }]}>Rename Goal</Text>
                    <TouchableOpacity
                      onPress={handleRenameGoal}
                      disabled={submittingRename}
                      style={[styles.modalSaveBtn, { backgroundColor: colors.primary, opacity: submittingRename ? 0.7 : 1 }]}
                    >
                      {submittingRename ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.modalSaveBtnText}>Save</Text>
                      )}
                    </TouchableOpacity>
                  </View>

                  <View style={styles.modalBody}>
                    <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>GOAL NAME</Text>
                    <TextInput
                      style={[styles.textInput, {
                        backgroundColor: colors.muted,
                        borderColor: colors.border,
                        color: colors.foreground,
                        borderRadius: colors.radius,
                      }]}
                      placeholder="e.g. Emergency Fund"
                      placeholderTextColor={colors.mutedForeground}
                      value={renameName}
                      onChangeText={setRenameName}
                      autoFocus
                      returnKeyType="done"
                      onSubmitEditing={handleRenameGoal}
                    />
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 24,
    paddingBottom: 28,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '700' as const,
    color: '#f7faf6',
    fontFamily: 'Inter_700Bold',
  },
  newGoalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#4ade80',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  newGoalBtnText: {
    fontSize: 13,
    fontWeight: '700' as const,
    fontFamily: 'Inter_700Bold',
    color: '#0a1a10',
  },
  headerStats: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 16,
    paddingVertical: 14,
  },
  headerStat: { flex: 1, alignItems: 'center' },
  headerStatLabel: {
    fontSize: 11,
    color: '#7aaa8a',
    fontFamily: 'Inter_400Regular',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  headerStatValue: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#f7faf6',
    fontFamily: 'Inter_700Bold',
  },
  headerDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.12)' },
  list: { paddingHorizontal: 16, paddingTop: 20 },
  sectionLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1,
    marginBottom: 10,
    marginLeft: 4,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  cardInfo: { flex: 1 },
  cardName: {
    fontSize: 16,
    fontWeight: '600' as const,
    fontFamily: 'Inter_600SemiBold',
  },
  cardSub: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  cardRight: { alignItems: 'flex-end', justifyContent: 'space-between', gap: 4 },
  kebabBtn: { padding: 4 },
  cardPct: {
    fontSize: 18,
    fontWeight: '700' as const,
    fontFamily: 'Inter_700Bold',
  },
  barTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 10,
  },
  barFill: { height: '100%', borderRadius: 4 },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardAmounts: { flexDirection: 'row', gap: 6, flexShrink: 1, flexWrap: 'wrap' },
  cardAmountSaved: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  cardAmountTarget: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  contributeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
    flexShrink: 0,
  },
  contributeBtnText: {
    fontSize: 12,
    fontWeight: '600' as const,
    fontFamily: 'Inter_600SemiBold',
    color: '#4ade80',
  },
  cascadeGoalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  cascadeGoalName: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    fontWeight: '600' as const,
  },
  cascadeResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  empty: { alignItems: 'center', paddingTop: 80, gap: 10 },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    fontFamily: 'Inter_600SemiBold',
    marginTop: 4,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  // Modal shared
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalAvoid: { width: '100%' },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  modalHeaderBtn: { padding: 4 },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700' as const,
    fontFamily: 'Inter_700Bold',
  },
  modalSaveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    minWidth: 68,
    alignItems: 'center',
  },
  modalSaveBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700' as const,
    fontFamily: 'Inter_700Bold',
  },
  modalBody: {
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 6,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1,
    marginTop: 16,
    marginBottom: 8,
  },
  textInput: {
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    borderWidth: 1,
    fontFamily: 'Inter_400Regular',
  },
  // Contribute modal
  goalPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    marginTop: 4,
  },
  goalPillText: {
    fontSize: 14,
    fontWeight: '600' as const,
    fontFamily: 'Inter_600SemiBold',
    color: '#4ade80',
    flex: 1,
  },
  goalPillSub: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#7aaa8a',
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginBottom: 8,
  },
  currencyLabel: {
    fontSize: 22,
    fontWeight: '600' as const,
    fontFamily: 'Inter_600SemiBold',
    paddingBottom: 6,
  },
  amountInput: {
    fontSize: 48,
    fontWeight: '800' as const,
    fontFamily: 'Inter_700Bold',
    flex: 1,
    letterSpacing: -1,
  },
  // History modal
  historySheet: {
    maxHeight: '85%',
  },
  pickerOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  pickerSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40, maxHeight: '60%' },
  pickerHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
  pickerTitle: { fontSize: 16, fontWeight: '700' as const, fontFamily: 'Inter_700Bold', textAlign: 'center', paddingVertical: 12 },
  pickerList: { flexGrow: 0 },
  pickerItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12, marginHorizontal: 12, marginVertical: 1 },
  pickerItemText: { fontSize: 16, fontFamily: 'Inter_500Medium' },
  filterBar: {
    flexDirection: 'column',
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    gap: 8,
  },
  chipsScroll: {
    flexShrink: 0,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  filterPickers: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 8,
  },
  filterField: {
    flex: 1,
    gap: 4,
  },
  filterLabel: {
    fontSize: 9,
    fontWeight: '600' as const,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1,
    marginLeft: 2,
  },
  filterDivider: {
    width: 1,
    height: 40,
    backgroundColor: 'transparent',
  },
  filterClearBtn: {
    padding: 4,
    alignSelf: 'flex-end',
    marginBottom: 4,
  },
  contributorRow: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
  },
  filterSummaryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  filterSummaryText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  historySubtitle: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    marginTop: 1,
  },
  historyEmpty: {
    alignItems: 'center',
    paddingTop: 52,
    paddingHorizontal: 40,
    gap: 10,
  },
  historyEmptyTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    fontFamily: 'Inter_600SemiBold',
    marginTop: 4,
  },
  historyEmptyText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
  historyList: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
  },
  historyDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  historyRowInfo: {
    flex: 1,
  },
  historyRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  historyAmount: {
    fontSize: 15,
    fontWeight: '600' as const,
    fontFamily: 'Inter_600SemiBold',
  },
  historyContributor: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  historyDate: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  historyAdjustmentBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  historyAdjustmentBadgeText: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.3,
  },
  // Contributor summary strip
  contributorSummaryBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  contributorSummaryItem: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 12,
  },
  contributorSummaryDivider: {
    width: 1,
    marginVertical: 4,
  },
  contributorSummaryName: {
    fontSize: 10,
    fontWeight: '600' as const,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  contributorSummaryAmount: {
    fontSize: 15,
    fontWeight: '700' as const,
    fontFamily: 'Inter_700Bold',
  },
});
