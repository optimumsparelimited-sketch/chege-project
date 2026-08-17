import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Platform,
  Pressable,
  Modal,
  FlatList,
  TextInput,
  Alert,
  KeyboardAvoidingView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import {
  useGetContributions,
  useGetDashboardSummary,
  useCreateContribution,
  getGetContributionsQueryKey,
  getGetDashboardSummaryQueryKey,
  getGetDashboardActivityQueryKey,
} from '@workspace/api-client-react';

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const CHEGE_ID = '63497598';
const LYDIAH_ID = '63570605';

const INCOME_SOURCES: Record<string, { label: string; amount: number }[]> = {
  [CHEGE_ID]: [
    { label: 'Ujenzi Salary', amount: 76140 },
    { label: 'Rental Income', amount: 150000 },
    { label: 'Optimum', amount: 40954 },
  ],
  [LYDIAH_ID]: [
    { label: 'EISH', amount: 50000 },
  ],
};

const MEMBER_NAMES: Record<string, string> = {
  [CHEGE_ID]: 'Chege',
  [LYDIAH_ID]: 'Lydiah',
};

function formatKES(n?: number | null): string {
  if (n === undefined || n === null) return '—';
  return n.toLocaleString('en-KE', { maximumFractionDigits: 0 });
}

function formatDate(s?: string | null): string {
  if (!s) return '';
  const d = new Date(s);
  return d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const over = value > max;
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${pct * 100}%` as any, backgroundColor: over ? '#ef4444' : color }]} />
    </View>
  );
}

function MemberCard({
  name,
  initial,
  contributed,
  spent,
  net,
  target,
  accentColor,
  gradientColors,
}: {
  name: string;
  initial: string;
  contributed: number;
  spent: number;
  net: number;
  target: number;
  accentColor: string;
  gradientColors: [string, string];
}) {
  const pct = target > 0 ? Math.min((contributed / target) * 100, 100) : 0;
  const netPositive = net >= 0;

  return (
    <LinearGradient colors={gradientColors} style={styles.memberCard}>
      <View style={styles.memberCardTop}>
        <View>
          <Text style={styles.memberName}>{name}</Text>
          <Text style={styles.memberTarget}>Target: KES {formatKES(target)}</Text>
        </View>
        <View style={[styles.memberAvatar, { backgroundColor: accentColor + '33' }]}>
          <Text style={[styles.memberInitial, { color: accentColor }]}>{initial}</Text>
        </View>
      </View>

      {/* Three-column stats */}
      <View style={styles.memberStats}>
        <View style={styles.memberStatCell}>
          <Text style={styles.memberStatLabel}>Contributed</Text>
          <Text style={[styles.memberStatValue, { color: accentColor }]}>KES {formatKES(contributed)}</Text>
        </View>
        <View style={styles.memberStatDivider} />
        <View style={styles.memberStatCell}>
          <Text style={styles.memberStatLabel}>Spent</Text>
          <Text style={[styles.memberStatValue, { color: '#f87171' }]}>KES {formatKES(spent)}</Text>
        </View>
        <View style={styles.memberStatDivider} />
        <View style={styles.memberStatCell}>
          <Text style={styles.memberStatLabel}>Net</Text>
          <Text style={[styles.memberStatValue, { color: netPositive ? '#4ade80' : '#f87171' }]}>
            {netPositive ? '+' : ''}KES {formatKES(net)}
          </Text>
        </View>
      </View>

      <ProgressBar value={contributed} max={target} color={accentColor} />

      <View style={styles.memberFooter}>
        <Text style={styles.memberPct}>{Math.round(pct)}% of target</Text>
        <Text style={[styles.memberRemaining, { color: netPositive ? 'rgba(247,250,246,0.55)' : '#f87171' }]}>
          {netPositive ? `KES ${formatKES(Math.max(target - contributed, 0))} to go` : `Deficit KES ${formatKES(Math.abs(net))}`}
        </Text>
      </View>
    </LinearGradient>
  );
}

// ── Record-deposit bottom sheet ──────────────────────────────────────────────

function RecordDepositModal({
  visible,
  onClose,
  month,
  year,
  onSuccess,
}: {
  visible: boolean;
  onClose: () => void;
  month: number;
  year: number;
  onSuccess: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [forUserId, setForUserId] = useState(CHEGE_ID);
  const [selectedSource, setSelectedSource] = useState('');
  const [customAmount, setCustomAmount] = useState('');
  const [customNote, setCustomNote] = useState('');

  const { mutate: createContribution, isPending } = useCreateContribution({
    mutation: {
      onSuccess: () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        queryClient.invalidateQueries({ queryKey: getGetContributionsQueryKey({ month, year }) });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey({ month, year }) });
        queryClient.invalidateQueries({ queryKey: getGetDashboardActivityQueryKey() });
        onSuccess();
        handleReset();
      },
      onError: () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert('Error', 'Failed to record deposit. Please try again.');
      },
    },
  });

  const sources = INCOME_SOURCES[forUserId] ?? [];
  const isOther = selectedSource === 'other';
  const selectedSourceObj = sources.find(s => s.label === selectedSource);
  const finalAmount = isOther ? Number(customAmount.replace(/,/g, '')) : (selectedSourceObj?.amount ?? 0);

  function handleReset() {
    setSelectedSource('');
    setCustomAmount('');
    setCustomNote('');
  }

  function handlePersonChange(id: string) {
    setForUserId(id);
    handleReset();
  }

  function handleSubmit() {
    if (!selectedSource) {
      Alert.alert('Select a source', 'Please pick an income source or choose Custom.');
      return;
    }
    if (finalAmount <= 0) {
      Alert.alert('Amount required', 'Please enter a valid amount.');
      return;
    }
    createContribution({
      data: {
        amount: finalAmount,
        month,
        year,
        note: isOther ? (customNote.trim() || 'Other') : selectedSource,
        forUserId,
      },
    });
  }

  function handleClose() {
    handleReset();
    onClose();
  }

  const accentChege = '#4ade80';
  const accentLydiah = '#cf7217';
  const accent = forUserId === CHEGE_ID ? accentChege : accentLydiah;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <Pressable style={styles.modalOverlay} onPress={handleClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ width: '100%' }}
        >
          <Pressable
            style={[styles.modalSheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 24 }]}
            onPress={() => {}}
          >
            {/* Handle */}
            <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />

            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Record Deposit</Text>

            {/* Person toggle */}
            <Text style={[styles.sheetLabel, { color: colors.mutedForeground }]}>FOR</Text>
            <View style={styles.personToggle}>
              {([CHEGE_ID, LYDIAH_ID] as const).map((id) => {
                const name = MEMBER_NAMES[id];
                const isSelected = forUserId === id;
                const btnAccent = id === CHEGE_ID ? accentChege : accentLydiah;
                return (
                  <Pressable
                    key={id}
                    onPress={() => handlePersonChange(id)}
                    style={[
                      styles.personBtn,
                      isSelected
                        ? { backgroundColor: btnAccent + '22', borderColor: btnAccent }
                        : { backgroundColor: colors.muted, borderColor: colors.border },
                    ]}
                  >
                    <View style={[styles.personDot, { backgroundColor: isSelected ? btnAccent : colors.mutedForeground }]} />
                    <Text style={[styles.personBtnText, { color: isSelected ? btnAccent : colors.foreground }]}>
                      {name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Income source presets */}
            <Text style={[styles.sheetLabel, { color: colors.mutedForeground }]}>SOURCE</Text>
            <View style={styles.sourceGrid}>
              {sources.map((src) => {
                const selected = selectedSource === src.label;
                return (
                  <Pressable
                    key={src.label}
                    onPress={() => setSelectedSource(src.label)}
                    style={[
                      styles.sourceChip,
                      selected
                        ? { backgroundColor: accent + '22', borderColor: accent }
                        : { backgroundColor: colors.muted, borderColor: colors.border },
                    ]}
                  >
                    <Text style={[styles.sourceChipLabel, { color: selected ? accent : colors.foreground }]}>
                      {src.label}
                    </Text>
                    <Text style={[styles.sourceChipAmount, { color: selected ? accent : colors.mutedForeground }]}>
                      KES {formatKES(src.amount)}
                    </Text>
                  </Pressable>
                );
              })}
              {/* Custom option */}
              <Pressable
                onPress={() => setSelectedSource('other')}
                style={[
                  styles.sourceChip,
                  isOther
                    ? { backgroundColor: accent + '22', borderColor: accent }
                    : { backgroundColor: colors.muted, borderColor: colors.border },
                ]}
              >
                <Text style={[styles.sourceChipLabel, { color: isOther ? accent : colors.foreground }]}>Custom</Text>
                <Feather name="edit-2" size={12} color={isOther ? accent : colors.mutedForeground} style={{ marginTop: 2 }} />
              </Pressable>
            </View>

            {/* Custom amount + note */}
            {isOther && (
              <View style={styles.customFields}>
                <View style={[styles.customInput, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                  <Text style={[styles.customCurrency, { color: colors.mutedForeground }]}>KES</Text>
                  <TextInput
                    style={[styles.customAmountText, { color: colors.foreground }]}
                    placeholder="0"
                    placeholderTextColor={colors.mutedForeground}
                    keyboardType="numeric"
                    value={customAmount}
                    onChangeText={setCustomAmount}
                    autoFocus
                  />
                </View>
                <TextInput
                  style={[styles.customNoteInput, { backgroundColor: colors.muted, borderColor: colors.border, color: colors.foreground }]}
                  placeholder="Note (optional)"
                  placeholderTextColor={colors.mutedForeground}
                  value={customNote}
                  onChangeText={setCustomNote}
                  returnKeyType="done"
                />
              </View>
            )}

            {/* Preview amount */}
            {selectedSource && finalAmount > 0 && (
              <View style={[styles.amountPreview, { backgroundColor: accent + '11', borderColor: accent + '44' }]}>
                <Feather name="check-circle" size={14} color={accent} />
                <Text style={[styles.amountPreviewText, { color: accent }]}>
                  Recording KES {formatKES(finalAmount)} for {MEMBER_NAMES[forUserId]}
                </Text>
              </View>
            )}

            {/* Submit */}
            <Pressable
              onPress={handleSubmit}
              disabled={isPending || !selectedSource || finalAmount <= 0}
              style={[
                styles.submitBtn,
                {
                  backgroundColor: accent,
                  opacity: isPending || !selectedSource || finalAmount <= 0 ? 0.5 : 1,
                },
              ]}
            >
              {isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.submitBtnText}>Record Deposit</Text>
              )}
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────

export default function ContributionsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [pickerVisible, setPickerVisible] = useState(false);
  const [depositModalVisible, setDepositModalVisible] = useState(false);

  const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear();

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

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setMonth(1); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }

  function jumpToMonth(m: number, y: number) {
    setMonth(m);
    setYear(y);
    setPickerVisible(false);
  }

  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } = useGetDashboardSummary({ month, year });

  // Per-person net = contributed - spent
  const chegeNet = (summary?.chegeContributed ?? 0) - (summary?.chegeSpent ?? 0);
  const lydiahNet = (summary?.lydiahContributed ?? 0) - (summary?.lydiahSpent ?? 0);
  const { data: contributions, isLoading: contribLoading, refetch: refetchContrib } = useGetContributions({ month, year });

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchSummary(), refetchContrib()]);
    setRefreshing(false);
  }, [refetchSummary, refetchContrib]);

  const isLoading = summaryLoading || contribLoading;
  const total = contributions?.reduce((s, c) => s + c.amount, 0) ?? 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <LinearGradient
        colors={['#0a1a10', '#0f2217', '#132a1c']}
        style={[styles.header, { paddingTop: topPad + 16 }]}
      >
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Contributions</Text>
          <View style={styles.headerActions}>
            <View style={styles.monthNav}>
              <Pressable onPress={prevMonth} hitSlop={10} style={styles.navBtn}>
                <Feather name="chevron-left" size={20} color="rgba(247,250,246,0.7)" />
              </Pressable>
              <Pressable onPress={() => setPickerVisible(true)} hitSlop={6} style={styles.monthLabelBtn}>
                <Text style={styles.monthLabel}>{MONTHS_SHORT[month - 1]} {year}</Text>
                <Feather name="chevron-down" size={12} color="rgba(247,250,246,0.5)" style={{ marginLeft: 3 }} />
              </Pressable>
              <Pressable onPress={nextMonth} hitSlop={10} style={styles.navBtn} disabled={isCurrentMonth}>
                <Feather name="chevron-right" size={20} color={isCurrentMonth ? 'rgba(247,250,246,0.2)' : 'rgba(247,250,246,0.7)'} />
              </Pressable>
            </View>
            <Pressable
              onPress={() => setDepositModalVisible(true)}
              style={styles.recordBtn}
              hitSlop={8}
            >
              <Feather name="plus" size={16} color="#0a1a10" />
              <Text style={styles.recordBtnText}>Record</Text>
            </Pressable>
          </View>
        </View>

        {/* Combined total */}
        {!isLoading && summary && (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total contributed</Text>
            <Text style={styles.totalAmount}>KES {formatKES((summary.chegeContributed ?? 0) + (summary.lydiahContributed ?? 0))}</Text>
          </View>
        )}
      </LinearGradient>

      {/* Month Picker Modal */}
      <Modal visible={pickerVisible} animationType="slide" transparent onRequestClose={() => setPickerVisible(false)}>
        <Pressable style={styles.pickerOverlay} onPress={() => setPickerVisible(false)}>
          <Pressable style={[styles.pickerSheet, { backgroundColor: colors.card }]} onPress={() => {}}>
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
                    style={[styles.pickerItem, selected && { backgroundColor: '#1a3320' }]}
                  >
                    <Text style={[styles.pickerItemText, { color: selected ? '#4ade80' : colors.foreground }, selected && { fontFamily: 'Inter_700Bold' }]}>
                      {item.label}
                    </Text>
                    {selected && <Feather name="check" size={16} color="#4ade80" />}
                  </Pressable>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Record Deposit Modal */}
      <RecordDepositModal
        visible={depositModalVisible}
        onClose={() => setDepositModalVisible(false)}
        month={month}
        year={year}
        onSuccess={() => setDepositModalVisible(false)}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#4ade80" />}
        contentContainerStyle={[styles.scroll, { paddingBottom: Platform.OS === 'web' ? 100 : insets.bottom + 110 }]}
      >
        {isLoading ? (
          <ActivityIndicator color={colors.secondary} style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Member cards */}
            {summary && (
              <View style={styles.cards}>
                <MemberCard
                  name="Chege"
                  initial="C"
                  contributed={summary.chegeContributed ?? 0}
                  spent={summary.chegeSpent ?? 0}
                  net={chegeNet}
                  target={summary.chegeTarget ?? 0}
                  accentColor="#4ade80"
                  gradientColors={['#132a1c', '#0f2217']}
                />
                <MemberCard
                  name="Lydiah"
                  initial="L"
                  contributed={summary.lydiahContributed ?? 0}
                  spent={summary.lydiahSpent ?? 0}
                  net={lydiahNet}
                  target={summary.lydiahTarget ?? 0}
                  accentColor="#cf7217"
                  gradientColors={['#2a1c0a', '#1c130a']}
                />
              </View>
            )}

            {/* History list */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                  {contributions?.length ?? 0} {(contributions?.length ?? 0) === 1 ? 'entry' : 'entries'}
                </Text>
                {total > 0 && (
                  <Text style={[styles.sectionTotal, { color: colors.mutedForeground }]}>
                    KES {formatKES(total)} total
                  </Text>
                )}
              </View>

              {!contributions || contributions.length === 0 ? (
                <View style={styles.empty}>
                  <Feather name="inbox" size={36} color={colors.mutedForeground} />
                  <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No contributions yet</Text>
                  <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                    Tap Record above to log a deposit for Chege or Lydiah.
                  </Text>
                  <Pressable
                    onPress={() => setDepositModalVisible(true)}
                    style={[styles.emptyBtn, { borderColor: '#4ade80' }]}
                  >
                    <Feather name="plus" size={14} color="#4ade80" />
                    <Text style={[styles.emptyBtnText, { color: '#4ade80' }]}>Record first deposit</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={[styles.list, { borderColor: colors.border, backgroundColor: colors.card }]}>
                  {contributions.map((c, i) => (
                    <View
                      key={c.id}
                      style={[
                        styles.row,
                        { borderBottomColor: colors.border },
                        i === contributions.length - 1 && { borderBottomWidth: 0 },
                      ]}
                    >
                      <View style={[styles.rowIcon, { backgroundColor: c.userName?.toLowerCase().startsWith('c') ? '#1a3320' : '#2a1c0a' }]}>
                        <Text style={[styles.rowInitial, { color: c.userName?.toLowerCase().startsWith('c') ? '#4ade80' : '#cf7217' }]}>
                          {(c.userName ?? '?').charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View style={styles.rowInfo}>
                        <Text style={[styles.rowName, { color: colors.foreground }]}>{c.userName}</Text>
                        <Text style={[styles.rowMeta, { color: colors.mutedForeground }]}>
                          {c.note ? c.note : 'Contribution'} · {formatDate(c.createdAt)}
                        </Text>
                      </View>
                      <Text style={styles.rowAmount}>+KES {formatKES(c.amount)}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 24, paddingBottom: 24 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  headerTitle: { fontSize: 22, fontWeight: '700' as const, color: '#f7faf6', fontFamily: 'Inter_700Bold' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  monthNav: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  navBtn: { padding: 6 },
  monthLabelBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 4 },
  monthLabel: { fontSize: 14, fontWeight: '600' as const, color: '#f7faf6', fontFamily: 'Inter_600SemiBold', minWidth: 64, textAlign: 'center' },
  recordBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#4ade80',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
  },
  recordBtnText: { fontSize: 13, fontWeight: '700' as const, color: '#0a1a10', fontFamily: 'Inter_700Bold' },

  pickerOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  pickerSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40, maxHeight: '60%' },
  pickerHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
  pickerTitle: { fontSize: 16, fontWeight: '700' as const, fontFamily: 'Inter_700Bold', textAlign: 'center', paddingVertical: 12 },
  pickerList: { flexGrow: 0 },
  pickerItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12, marginHorizontal: 12, marginVertical: 1 },
  pickerItemText: { fontSize: 16, fontFamily: 'Inter_500Medium' },
  totalRow: { alignItems: 'center' },
  totalLabel: { fontSize: 11, color: '#7aaa8a', fontFamily: 'Inter_400Regular', letterSpacing: 0.5, marginBottom: 2 },
  totalAmount: { fontSize: 28, fontWeight: '700' as const, color: '#f7faf6', fontFamily: 'Inter_700Bold' },

  scroll: { paddingHorizontal: 16, paddingTop: 20, gap: 20 },

  cards: { gap: 12 },
  memberCard: { borderRadius: 18, padding: 20 },
  memberCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  memberAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  memberStats: { flexDirection: 'row' as const, backgroundColor: 'rgba(0,0,0,0.15)', borderRadius: 12, paddingVertical: 10, marginBottom: 12 },
  memberStatCell: { flex: 1, alignItems: 'center' as const },
  memberStatLabel: { fontSize: 9, color: 'rgba(247,250,246,0.5)', fontFamily: 'Inter_400Regular', marginBottom: 3, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  memberStatValue: { fontSize: 11, fontWeight: '700' as const, fontFamily: 'Inter_700Bold' },
  memberStatDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.12)' },
  memberInitial: { fontSize: 18, fontWeight: '700' as const, fontFamily: 'Inter_700Bold' },
  memberName: { fontSize: 18, fontWeight: '700' as const, color: '#f7faf6', fontFamily: 'Inter_700Bold' },
  memberTarget: { fontSize: 12, color: 'rgba(247,250,246,0.55)', fontFamily: 'Inter_400Regular', marginTop: 2 },
  memberAmount: { fontSize: 28, fontWeight: '700' as const, fontFamily: 'Inter_700Bold', marginBottom: 12 },
  progressTrack: { height: 6, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 3, overflow: 'hidden', marginBottom: 8 },
  progressFill: { height: '100%', borderRadius: 3 },
  memberFooter: { flexDirection: 'row', justifyContent: 'space-between' },
  memberPct: { fontSize: 12, color: 'rgba(247,250,246,0.55)', fontFamily: 'Inter_400Regular' },
  memberRemaining: { fontSize: 12, color: 'rgba(247,250,246,0.55)', fontFamily: 'Inter_400Regular' },

  section: { gap: 10 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: 13, fontWeight: '600' as const, fontFamily: 'Inter_600SemiBold' },
  sectionTotal: { fontSize: 13, fontFamily: 'Inter_400Regular' },

  list: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  rowIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  rowInitial: { fontSize: 16, fontWeight: '700' as const, fontFamily: 'Inter_700Bold' },
  rowInfo: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '500' as const, fontFamily: 'Inter_500Medium' },
  rowMeta: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  rowAmount: { fontSize: 15, fontWeight: '600' as const, fontFamily: 'Inter_600SemiBold', color: '#4ade80' },

  empty: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '600' as const, fontFamily: 'Inter_600SemiBold', marginTop: 4 },
  emptyText: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', paddingHorizontal: 30 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, marginTop: 8 },
  emptyBtnText: { fontSize: 14, fontWeight: '600' as const, fontFamily: 'Inter_600SemiBold' },

  // Deposit modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  modalSheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingTop: 12 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 8 },
  sheetTitle: { fontSize: 18, fontWeight: '700' as const, fontFamily: 'Inter_700Bold', textAlign: 'center', marginBottom: 20 },
  sheetLabel: { fontSize: 10, fontWeight: '600' as const, fontFamily: 'Inter_600SemiBold', letterSpacing: 1, marginBottom: 8 },
  personToggle: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  personBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  personDot: { width: 8, height: 8, borderRadius: 4 },
  personBtnText: { fontSize: 15, fontWeight: '600' as const, fontFamily: 'Inter_600SemiBold' },
  sourceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  sourceChip: {
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: '45%',
    flex: 1,
  },
  sourceChipLabel: { fontSize: 13, fontWeight: '600' as const, fontFamily: 'Inter_600SemiBold', marginBottom: 2 },
  sourceChipAmount: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  customFields: { gap: 10, marginBottom: 16 },
  customInput: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  customCurrency: { fontSize: 16, fontWeight: '600' as const, fontFamily: 'Inter_600SemiBold' },
  customAmountText: { fontSize: 22, fontWeight: '700' as const, fontFamily: 'Inter_700Bold', flex: 1 },
  customNoteInput: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
  },
  amountPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
  },
  amountPreviewText: { fontSize: 13, fontFamily: 'Inter_500Medium', flex: 1 },
  submitBtn: {
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  submitBtnText: { fontSize: 16, fontWeight: '700' as const, color: '#fff', fontFamily: 'Inter_700Bold' },
});
