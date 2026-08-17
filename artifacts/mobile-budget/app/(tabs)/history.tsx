import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  Platform,
  Alert,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  ScrollView,
  TouchableWithoutFeedback,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/lib/auth';
import {
  useGetExpenses,
  useGetDashboardActivity,
  useUpdateExpense,
  useDeleteExpense,
  useApplyRecurringExpenses,
  useGetBudgetCategories,
  useGetMembers,
  getGetExpensesQueryKey,
  getGetDashboardSummaryQueryKey,
  getGetDashboardActivityQueryKey,
  getGetDashboardCategoryBreakdownQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import ActivityCard from '@/components/ActivityCard';

const MONTH_PREF_KEY = 'expenses_month_pref';

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const CATEGORY_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  Food: 'shopping-cart', Transport: 'truck', Health: 'heart', Education: 'book',
  Utilities: 'zap', Entertainment: 'tv', Clothing: 'tag', Savings: 'archive',
  Housing: 'home', Communication: 'phone', Other: 'more-horizontal',
};

function formatKES(n: number) {
  return n.toLocaleString('en-KE', { maximumFractionDigits: 0 });
}

function formatDate(s: string) {
  return new Date(s).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}

type Expense = {
  id: number;
  amount: number;
  category: string;
  description: string;
  notes?: string | null;
  paidById: string;
  paidByName: string;
  isRecurring: boolean;
  date: string;
  createdAt: string;
};

type EditForm = {
  amount: string;
  category: string;
  description: string;
  notes: string;
  paidById: string;
  date: string;
};

type FeedTab = 'expenses' | 'activity';

export default function HistoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [pickerVisible, setPickerVisible] = useState(false);
  const [activeTab, setActiveTab] = useState<FeedTab>('expenses');

  // Restore last-viewed month from AsyncStorage
  useEffect(() => {
    AsyncStorage.getItem(MONTH_PREF_KEY).then((raw) => {
      if (!raw) return;
      try {
        const { m, y } = JSON.parse(raw);
        if (typeof m === 'number' && typeof y === 'number') {
          setMonth(m);
          setYear(y);
        }
      } catch {}
    });
  }, []);

  // Persist selected month whenever it changes
  useEffect(() => {
    AsyncStorage.setItem(MONTH_PREF_KEY, JSON.stringify({ m: month, y: year })).catch(() => {});
  }, [month, year]);

  // Build list of last 24 months (most-recent first)
  const monthOptions = useMemo(() => {
    const result: { month: number; year: number; label: string }[] = [];
    const d = new Date(now.getFullYear(), now.getMonth(), 1);
    for (let i = 0; i < 24; i++) {
      result.push({
        month: d.getMonth() + 1,
        year: d.getFullYear(),
        label: `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`,
      });
      d.setMonth(d.getMonth() - 1);
    }
    return result;
  }, []);

  function jumpToMonth(m: number, y: number) {
    setMonth(m);
    setYear(y);
    setPickerVisible(false);
  }

  const { data: expenses = [], isLoading, refetch } = useGetExpenses({ month, year });
  const prevMonthNum = month === 1 ? 12 : month - 1;
  const prevYearNum = month === 1 ? year - 1 : year;
  const { data: prevExpenses = [] } = useGetExpenses({ month: prevMonthNum, year: prevYearNum });
  const recurringFromPrev = prevExpenses.filter((e: Expense) => e.isRecurring);
  const alreadyApplied = expenses.some((e: Expense) => e.isRecurring);
  const showRecurringBanner = recurringFromPrev.length > 0 && !alreadyApplied &&
    month === now.getMonth() + 1 && year === now.getFullYear();
  const applyRecurring = useApplyRecurringExpenses();
  const [applyingRecurring, setApplyingRecurring] = useState(false);
  const { data: categories = [] } = useGetBudgetCategories();
  const { data: members = [] } = useGetMembers();
  const updateExpense = useUpdateExpense();
  const deleteExpense = useDeleteExpense();

  const handleApplyRecurring = async () => {
    setApplyingRecurring(true);
    try {
      await applyRecurring.mutateAsync({ data: { month, year } });
      queryClient.invalidateQueries({ queryKey: getGetExpensesQueryKey({ month, year }) });
      queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey({ month, year }) });
      queryClient.invalidateQueries({ queryKey: getGetDashboardCategoryBreakdownQueryKey({ month, year }) });
      queryClient.invalidateQueries({ queryKey: getGetDashboardActivityQueryKey() });
    } catch {
      Alert.alert('Error', 'Could not apply recurring expenses.');
    } finally {
      setApplyingRecurring(false);
    }
  };

  // Activity feed (for the "Activity" tab)
  const { data: activityFeed = [], isLoading: activityLoading, refetch: refetchActivity } = useGetDashboardActivity();

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (activeTab === 'activity') {
      await refetchActivity();
    } else {
      await refetch();
    }
    setRefreshing(false);
  }, [refetch, refetchActivity, activeTab]);

  // Edit modal state
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ amount: '', category: '', description: '', notes: '', paidById: '', date: '' });
  const [saving, setSaving] = useState(false);

  const openEdit = (exp: Expense) => {
    setEditForm({
      amount: String(exp.amount),
      category: exp.category,
      description: exp.description,
      notes: exp.notes ?? '',
      paidById: exp.paidById ?? '',
      date: exp.date,
    });
    setEditingExpense(exp);
  };

  const closeEdit = () => { setEditingExpense(null); setSaving(false); };

  const handleSave = async () => {
    if (!editingExpense) return;
    const parsed = parseFloat(editForm.amount);
    if (!parsed || parsed <= 0 || !editForm.category || !editForm.description || !editForm.date) {
      Alert.alert('Missing fields', 'Please fill in amount, category, description and date.');
      return;
    }
    if (!editForm.paidById) {
      Alert.alert('Paid by required', 'Please choose who paid for this expense.');
      return;
    }
    setSaving(true);
    try {
      await updateExpense.mutateAsync({
        id: editingExpense.id,
        data: {
          amount: parsed,
          category: editForm.category,
          description: editForm.description,
          notes: editForm.notes || undefined,
          paidById: editForm.paidById,
          date: editForm.date,
          isRecurring: editingExpense.isRecurring,
        },
      });
      queryClient.invalidateQueries({ queryKey: getGetExpensesQueryKey({ month, year }) });
      queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey({ month, year }) });
      queryClient.invalidateQueries({ queryKey: getGetDashboardActivityQueryKey() });
      closeEdit();
    } catch {
      Alert.alert('Error', 'Could not save changes.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (exp: Expense) => {
    Alert.alert('Delete expense', `Delete "${exp.description}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await deleteExpense.mutateAsync({ id: exp.id });
            queryClient.invalidateQueries({ queryKey: getGetExpensesQueryKey({ month, year }) });
            queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey({ month, year }) });
            queryClient.invalidateQueries({ queryKey: getGetDashboardActivityQueryKey() });
          } catch {
            Alert.alert('Error', 'Could not delete expense.');
          }
        },
      },
    ]);
  };

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear();

  function prevMonth() { if (month === 1) { setMonth(12); setYear((y) => y - 1); } else setMonth((m) => m - 1); }
  function nextMonth() { if (month === 12) { setMonth(1); setYear((y) => y + 1); } else setMonth((m) => m + 1); }

  const totalSpent = expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        {/* Title row */}
        <View style={styles.headerTitleRow}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            {activeTab === 'expenses' ? 'Expenses' : 'Activity'}
          </Text>
          {activeTab === 'expenses' && expenses.length > 0 && (
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
              {expenses.length} entries · KES {formatKES(totalSpent)}
            </Text>
          )}
          {activeTab === 'activity' && activityFeed.length > 0 && (
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
              Recent {activityFeed.length} items
            </Text>
          )}
        </View>

        {/* Segment switcher + month nav */}
        <View style={styles.headerControls}>
          {/* Tab toggle */}
          <View style={[styles.segmentBar, { backgroundColor: colors.muted }]}>
            <Pressable
              onPress={() => setActiveTab('expenses')}
              style={[styles.segmentBtn, activeTab === 'expenses' && { backgroundColor: colors.card, borderRadius: 8 }]}
            >
              <Feather name="list" size={13} color={activeTab === 'expenses' ? colors.foreground : colors.mutedForeground} />
              <Text style={[styles.segmentText, { color: activeTab === 'expenses' ? colors.foreground : colors.mutedForeground }]}>Expenses</Text>
            </Pressable>
            <Pressable
              onPress={() => setActiveTab('activity')}
              style={[styles.segmentBtn, activeTab === 'activity' && { backgroundColor: colors.card, borderRadius: 8 }]}
            >
              <Feather name="activity" size={13} color={activeTab === 'activity' ? colors.foreground : colors.mutedForeground} />
              <Text style={[styles.segmentText, { color: activeTab === 'activity' ? colors.foreground : colors.mutedForeground }]}>Activity</Text>
            </Pressable>
          </View>

          {/* Month nav — only in expenses tab */}
          {activeTab === 'expenses' && (
            <View style={styles.monthNav}>
              <Pressable onPress={prevMonth} style={styles.navBtn} hitSlop={8}>
                <Feather name="chevron-left" size={20} color={colors.mutedForeground} />
              </Pressable>
              <Pressable onPress={() => setPickerVisible(true)} hitSlop={6} style={styles.monthLabelBtn}>
                <Text style={[styles.monthLabel, { color: colors.foreground }]}>{MONTHS_SHORT[month - 1]} {year}</Text>
                <Feather name="chevron-down" size={12} color={colors.mutedForeground} style={{ marginLeft: 3 }} />
              </Pressable>
              <Pressable onPress={nextMonth} style={styles.navBtn} hitSlop={8} disabled={isCurrentMonth}>
                <Feather name="chevron-right" size={20} color={isCurrentMonth ? colors.border : colors.mutedForeground} />
              </Pressable>
            </View>
          )}
        </View>
      </View>

      {/* Month Picker Modal */}
      <Modal visible={pickerVisible} animationType="slide" transparent onRequestClose={() => setPickerVisible(false)}>
        <TouchableWithoutFeedback onPress={() => setPickerVisible(false)}>
          <View style={styles.pickerOverlay}>
            <TouchableWithoutFeedback onPress={() => {}}>
              <View style={[styles.pickerSheet, { backgroundColor: colors.card }]}>
                <View style={[styles.pickerHandle, { backgroundColor: colors.border }]} />
                <Text style={[styles.pickerTitle, { color: colors.foreground }]}>Jump to month</Text>
                <FlatList
                  data={monthOptions}
                  keyExtractor={(item) => `${item.year}-${item.month}`}
                  showsVerticalScrollIndicator={false}
                  style={styles.pickerList}
                  renderItem={({ item }) => {
                    const selected = item.month === month && item.year === year;
                    return (
                      <Pressable
                        onPress={() => jumpToMonth(item.month, item.year)}
                        style={[styles.pickerItem, selected && { backgroundColor: colors.accent }]}
                      >
                        <Text style={[styles.pickerItemText, { color: selected ? colors.accentForeground : colors.foreground }, selected && { fontFamily: 'Inter_700Bold' }]}>
                          {item.label}
                        </Text>
                        {selected && <Feather name="check" size={16} color={colors.accentForeground} />}
                      </Pressable>
                    );
                  }}
                />
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Recurring banner — expenses tab only */}
      {activeTab === 'expenses' && showRecurringBanner && (
        <Pressable
          onPress={handleApplyRecurring}
          disabled={applyingRecurring}
          style={[styles.recurringBanner, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Feather name="refresh-cw" size={15} color={colors.primary} />
          <Text style={[styles.recurringBannerText, { color: colors.foreground }]}>
            {recurringFromPrev.length} recurring expense{recurringFromPrev.length !== 1 ? 's' : ''} from last month
          </Text>
          <Text style={[styles.recurringBannerAction, { color: colors.primary }]}>
            {applyingRecurring ? 'Applying…' : 'Apply'}
          </Text>
        </Pressable>
      )}

      {activeTab === 'expenses' ? (
        isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} size="large" />
        ) : (
          <FlatList
            data={expenses as Expense[]}
            keyExtractor={(item) => String(item.id)}
            renderItem={({ item }) => (
              <ExpenseRow
                expense={item}
                colors={colors}
                onEdit={() => openEdit(item)}
                onDelete={() => handleDelete(item)}
              />
            )}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
            contentContainerStyle={[styles.list, { paddingBottom: Platform.OS === 'web' ? 100 : insets.bottom + 100 }]}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Feather name="inbox" size={36} color={colors.mutedForeground} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No expenses</Text>
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>{MONTHS_SHORT[month - 1]} {year} is empty</Text>
              </View>
            }
          />
        )
      ) : (
        activityLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} size="large" />
        ) : (
          <FlatList
            data={activityFeed as Array<{ id: string; type: string; amount: number; description: string; userName: string; category: string | null; date: string }>}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <ActivityCard item={item} colors={colors} />
            )}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
            contentContainerStyle={[styles.list, { paddingBottom: Platform.OS === 'web' ? 100 : insets.bottom + 100 }]}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Feather name="activity" size={36} color={colors.mutedForeground} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No activity yet</Text>
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Expenses and contributions will appear here</Text>
              </View>
            }
          />
        )
      )}

      {/* FAB */}
      <Pressable
        style={[styles.fab, { backgroundColor: colors.secondary, bottom: Platform.OS === 'web' ? 100 : insets.bottom + 70 }]}
        onPress={() => router.push('/add-expense')}
        hitSlop={8}
      >
        <Feather name="plus" size={28} color="#fff" />
      </Pressable>

      {/* Edit Modal */}
      <Modal visible={!!editingExpense} animationType="slide" transparent onRequestClose={closeEdit}>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalKAV}>
            <View style={[styles.modalSheet, { backgroundColor: colors.card }]}>
              {/* Handle bar */}
              <View style={[styles.handleBar, { backgroundColor: colors.border }]} />

              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>Edit Expense</Text>
                <Pressable onPress={closeEdit} hitSlop={8}>
                  <Feather name="x" size={22} color={colors.mutedForeground} />
                </Pressable>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalBody}>
                {/* Amount */}
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Amount (KES)</Text>
                <TextInput
                  style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.muted }]}
                  value={editForm.amount}
                  onChangeText={v => setEditForm(f => ({ ...f, amount: v }))}
                  keyboardType="numeric"
                  placeholder="e.g. 5000"
                  placeholderTextColor={colors.mutedForeground}
                />

                {/* Description */}
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Description</Text>
                <TextInput
                  style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.muted }]}
                  value={editForm.description}
                  onChangeText={v => setEditForm(f => ({ ...f, description: v }))}
                  placeholder="e.g. School fees"
                  placeholderTextColor={colors.mutedForeground}
                />

                {/* Category */}
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Category</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                  {categories.map(c => {
                    const sel = editForm.category === c.name;
                    return (
                      <Pressable
                        key={c.id}
                        onPress={() => setEditForm(f => ({ ...f, category: c.name }))}
                        style={[styles.chip, { backgroundColor: sel ? colors.secondary : colors.muted, borderColor: sel ? colors.secondary : colors.border }]}
                      >
                        <Feather name={CATEGORY_ICONS[c.name] ?? 'tag'} size={12} color={sel ? '#fff' : colors.mutedForeground} />
                        <Text style={[styles.chipText, { color: sel ? '#fff' : colors.foreground }]}>{c.name}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>

                {/* Paid by */}
                <Text style={[styles.label, { color: colors.mutedForeground }]}>
                  Paid by <Text style={{ color: '#ef4444' }}>*</Text>
                </Text>
                <View style={styles.memberRow}>
                  {members.map(m => {
                    const sel = editForm.paidById === m.userId;
                    const name = m.userName?.split(' ')[0] ?? 'Member';
                    return (
                      <Pressable
                        key={m.userId}
                        onPress={() => setEditForm(f => ({ ...f, paidById: m.userId }))}
                        style={[styles.memberPill, { backgroundColor: sel ? '#4ade80' : colors.muted, borderColor: sel ? '#4ade80' : colors.border }]}
                      >
                        <Feather name="user" size={12} color={sel ? '#0a1a10' : colors.mutedForeground} />
                        <Text style={[styles.memberPillText, { color: sel ? '#0a1a10' : colors.foreground }]}>{name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {!editForm.paidById && (
                  <Text style={[styles.memberPillText, { color: colors.mutedForeground, marginTop: 4 }]}>
                    Tap to choose who paid
                  </Text>
                )}

                {/* Notes */}
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Notes <Text style={{ fontWeight: '400' }}>(optional)</Text></Text>
                <TextInput
                  style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.muted }]}
                  value={editForm.notes}
                  onChangeText={v => setEditForm(f => ({ ...f, notes: v }))}
                  placeholder="Any extra details"
                  placeholderTextColor={colors.mutedForeground}
                />

                {/* Date */}
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Date</Text>
                <TextInput
                  style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.muted }]}
                  value={editForm.date}
                  onChangeText={v => setEditForm(f => ({ ...f, date: v }))}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.mutedForeground}
                />

                {/* Save */}
                <Pressable
                  onPress={handleSave}
                  disabled={saving}
                  style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                >
                  {saving
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={styles.saveBtnText}>Save Changes</Text>}
                </Pressable>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

function ExpenseRow({
  expense, colors, onEdit, onDelete,
}: {
  expense: Expense;
  colors: any;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const icon: keyof typeof Feather.glyphMap = CATEGORY_ICONS[expense.category] ?? 'shopping-bag';
  return (
    <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.rowIcon, { backgroundColor: colors.accent }]}>
        <Feather name={icon} size={16} color={colors.accentForeground} />
      </View>
      <View style={styles.rowInfo}>
        <Text style={[styles.rowDesc, { color: colors.foreground }]} numberOfLines={1}>{expense.description}</Text>
        <Text style={[styles.rowMeta, { color: colors.mutedForeground }]}>
          {expense.paidByName} · {expense.category} · {formatDate(expense.date)}
        </Text>
        {expense.notes ? <Text style={[styles.rowNotes, { color: colors.mutedForeground }]}>{expense.notes}</Text> : null}
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.rowAmount, { color: colors.foreground }]}>
          −{expense.amount.toLocaleString('en-KE', { maximumFractionDigits: 0 })}
        </Text>
        <View style={styles.rowActions}>
          <Pressable onPress={onEdit} hitSlop={6} style={styles.actionBtn}>
            <Feather name="edit-2" size={14} color={colors.mutedForeground} />
          </Pressable>
          <Pressable onPress={onDelete} hitSlop={6} style={styles.actionBtn}>
            <Feather name="trash-2" size={14} color="#ef4444" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 10 },
  headerTitle: { fontSize: 22, fontWeight: '700' as const, fontFamily: 'Inter_700Bold' },
  headerSub: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  headerControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  segmentBar: { flexDirection: 'row', borderRadius: 10, padding: 3, gap: 2 },
  segmentBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7 },
  segmentText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  monthNav: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  navBtn: { padding: 4 },
  monthLabelBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingVertical: 4 },
  monthLabel: { fontSize: 13, fontFamily: 'Inter_500Medium', minWidth: 56, textAlign: 'center' },

  pickerOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  pickerSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40, maxHeight: '60%' },
  pickerHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
  pickerTitle: { fontSize: 16, fontWeight: '700' as const, fontFamily: 'Inter_700Bold', textAlign: 'center', paddingVertical: 12 },
  pickerList: { flexGrow: 0 },
  pickerItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12, marginHorizontal: 12, marginVertical: 1 },
  pickerItemText: { fontSize: 16, fontFamily: 'Inter_500Medium' },

  recurringBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 14, marginTop: 10, padding: 12, borderRadius: 10, borderWidth: 1 },
  recurringBannerText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular' },
  recurringBannerAction: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  list: { paddingHorizontal: 14, paddingTop: 14 },

  row: { flexDirection: 'row', alignItems: 'center', padding: 12, borderWidth: 1, borderRadius: 12, marginBottom: 10, gap: 10 },
  rowIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  rowInfo: { flex: 1 },
  rowDesc: { fontSize: 14, fontWeight: '600' as const, fontFamily: 'Inter_600SemiBold' },
  rowMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  rowNotes: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 1, fontStyle: 'italic' },
  rowRight: { alignItems: 'flex-end', gap: 6 },
  rowAmount: { fontSize: 14, fontWeight: '700' as const, fontFamily: 'Inter_700Bold' },
  rowActions: { flexDirection: 'row', gap: 8 },
  actionBtn: { padding: 2 },

  empty: { alignItems: 'center', paddingTop: 80, gap: 10 },
  emptyTitle: { fontSize: 18, fontWeight: '600' as const, fontFamily: 'Inter_600SemiBold', marginTop: 4 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular' },

  fab: { position: 'absolute', right: 20, width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 10, elevation: 10 },

  // Modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalKAV: { justifyContent: 'flex-end' },
  modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '90%' },
  handleBar: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  modalTitle: { fontSize: 18, fontWeight: '700' as const, fontFamily: 'Inter_700Bold' },
  modalBody: { paddingHorizontal: 20, paddingBottom: 40 },

  label: { fontSize: 12, fontWeight: '600' as const, fontFamily: 'Inter_600SemiBold', marginBottom: 6, marginTop: 14 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: 'Inter_400Regular' },

  chipScroll: { marginBottom: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, marginRight: 8 },
  chipText: { fontSize: 13, fontFamily: 'Inter_500Medium' },

  memberRow: { flexDirection: 'row', gap: 10, marginBottom: 4 },
  memberPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, borderWidth: 1 },
  memberPillText: { fontSize: 13, fontWeight: '600' as const, fontFamily: 'Inter_600SemiBold' },

  saveBtn: { marginTop: 24, backgroundColor: '#4ade80', borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  saveBtnText: { fontSize: 16, fontWeight: '700' as const, fontFamily: 'Inter_700Bold', color: '#0a1a10' },
});
