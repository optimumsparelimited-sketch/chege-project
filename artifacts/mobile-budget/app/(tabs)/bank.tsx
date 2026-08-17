import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Platform,
  Modal,
  Pressable,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/lib/auth';
import {
  useGetJointAccount,
  useCreateDeposit,
  useCreateDisbursement,
  useDeleteJointAccountTransaction,
  useGetBudgetCategories,
  useGetMembers,
  getGetJointAccountQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

function formatKES(n?: number | null): string {
  if (n === undefined || n === null) return '—';
  return n.toLocaleString('en-KE', { maximumFractionDigits: 0 });
}

function formatDateTime(s?: string | null): string {
  if (!s) return '';
  const d = new Date(s);
  return (
    d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }) +
    ' · ' +
    d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })
  );
}

type Tx = {
  id: number;
  type: string;
  amount: number;
  description: string;
  madeByName?: string | null;
  expenseCategory?: string | null;
  createdAt?: string | null;
};

type TxType = 'deposit' | 'disbursement';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function BankScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useGetJointAccount();

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  // Modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [txType, setTxType] = useState<TxType>('deposit');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [expenseCategory, setExpenseCategory] = useState('');
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [date, setDate] = useState(todayIso());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const { mutateAsync: createDeposit } = useCreateDeposit();
  const { mutateAsync: createDisbursement } = useCreateDisbursement();
  const { mutateAsync: deleteTransaction } = useDeleteJointAccountTransaction();
  const { data: categories = [] } = useGetBudgetCategories();
  const { data: members = [] } = useGetMembers();
  const { user } = useAuth();
  const [madeById, setMadeById] = useState('');

  const openModal = (type: TxType) => {
    setTxType(type);
    setAmount('');
    setDescription('');
    setExpenseCategory('');
    setShowCategoryPicker(false);
    setDate(todayIso());
    setShowDatePicker(false);
    setMadeById('');
    setModalVisible(true);
  };

  const closeModal = () => {
    if (submitting) return;
    setModalVisible(false);
  };

  // Invalidate everywhere that displays the joint-account balance so all
  // screens (home card + bank tab) update immediately after any mutation.
  const invalidateBalance = () =>
    queryClient.invalidateQueries({ queryKey: getGetJointAccountQueryKey() });

  const handleDelete = (tx: Tx) => {
    Alert.alert(
      'Delete transaction',
      `Delete "${tx.description}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: async () => {
            try {
              await deleteTransaction({ id: tx.id });
              await invalidateBalance();
            } catch {
              Alert.alert('Error', 'Could not delete transaction.');
            }
          },
        },
      ],
    );
  };

  const handleSubmit = async () => {
    const parsed = parseFloat(amount.replace(/,/g, ''));
    if (!parsed || parsed <= 0) {
      Alert.alert('Invalid amount', 'Please enter a valid amount greater than zero.');
      return;
    }
    if (!description.trim()) {
      Alert.alert('Description required', 'Please enter a description.');
      return;
    }

    setSubmitting(true);
    try {
      if (txType === 'deposit') {
        await createDeposit({
          data: { amount: parsed, description: description.trim(), date, madeById: madeById || undefined },
        });
      } else {
        await createDisbursement({
          data: { amount: parsed, description: description.trim(), date, expenseCategory: expenseCategory || undefined },
        });
      }
      setModalVisible(false);
      await invalidateBalance();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      Alert.alert('Error', message);
    } finally {
      setSubmitting(false);
    }
  };

  const transactions: Tx[] = data?.transactions ?? [];

  const isDeposit = txType === 'deposit';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Sticky header */}
      <LinearGradient
        colors={['#0a1a10', '#0f2217', '#132a1c']}
        style={[styles.header, { paddingTop: topPad + 16 }]}
      >
        <Text style={styles.headerTitle}>Bank Account</Text>
        {isLoading ? (
          <ActivityIndicator color="#4ade80" style={{ marginTop: 16, marginBottom: 8 }} />
        ) : (
          <>
            <Text style={styles.balanceLabel}>Current Balance</Text>
            <Text style={styles.balance}>KES {formatKES(data?.balance)}</Text>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Feather name="arrow-down-circle" size={14} color="#4ade80" />
                <Text style={styles.statLabel}>Deposits</Text>
                <Text style={styles.statValue}>KES {formatKES(data?.totalDeposits)}</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Feather name="arrow-up-circle" size={14} color="#f87171" />
                <Text style={styles.statLabel}>Disbursed</Text>
                <Text style={styles.statValue}>KES {formatKES(data?.totalDisbursements)}</Text>
              </View>
            </View>

            {/* Action buttons inside header */}
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => openModal('deposit')}
                activeOpacity={0.8}
              >
                <Feather name="arrow-down-left" size={16} color="#0a1a10" />
                <Text style={styles.actionBtnText}>Deposit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnDisburse]}
                onPress={() => openModal('disbursement')}
                activeOpacity={0.8}
              >
                <Feather name="arrow-up-right" size={16} color="#f87171" />
                <Text style={[styles.actionBtnText, styles.actionBtnTextDisburse]}>Disburse</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </LinearGradient>

      <FlatList
        data={transactions}
        keyExtractor={(item) => String(item.id)}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.secondary}
          />
        }
        contentContainerStyle={[
          styles.list,
          { paddingBottom: Platform.OS === 'web' ? 100 : insets.bottom + 110 },
        ]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          transactions.length > 0 ? (
            <Text style={[styles.listHeader, { color: colors.mutedForeground }]}>TRANSACTIONS</Text>
          ) : null
        }
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.empty}>
              <Feather name="credit-card" size={40} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                No transactions yet
              </Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                Deposits and disbursements will appear here
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const dep = item.type === 'deposit';
          return (
            <Pressable
              onLongPress={() => handleDelete(item)}
              delayLongPress={400}
              style={({ pressed }) => [
                styles.txRow,
                { borderBottomColor: colors.border, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <View style={[styles.txIcon, { backgroundColor: dep ? '#1a3320' : '#3a1a1a' }]}>
                <Feather
                  name={dep ? 'arrow-down-left' : 'arrow-up-right'}
                  size={18}
                  color={dep ? '#4ade80' : '#f87171'}
                />
              </View>
              <View style={styles.txInfo}>
                <Text style={[styles.txDesc, { color: colors.foreground }]} numberOfLines={1}>
                  {item.description}
                </Text>
                <Text style={[styles.txMeta, { color: colors.mutedForeground }]}>
                  {dep
                    ? (item.madeByName ? `${item.madeByName} · ` : '')
                    : ((item as Tx & { expenseCategory?: string | null }).expenseCategory
                        ? `→ ${(item as Tx & { expenseCategory?: string | null }).expenseCategory} · `
                        : '')}
                  {formatDateTime(item.createdAt)}
                </Text>
              </View>
              <Text style={[styles.txAmount, { color: dep ? '#4ade80' : '#f87171' }]}>
                {dep ? '+' : '-'}KES {formatKES(item.amount)}
              </Text>
            </Pressable>
          );
        }}
      />

      {/* Transaction modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={closeModal}
      >
        <TouchableWithoutFeedback onPress={closeModal}>
          <View style={styles.modalOverlay} />
        </TouchableWithoutFeedback>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalWrapper}
          pointerEvents="box-none"
        >
          <View style={[styles.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 24 }]}>
            {/* Sheet handle */}
            <View style={[styles.handle, { backgroundColor: colors.border }]} />

            {/* Type toggle */}
            <View style={[styles.toggle, { backgroundColor: colors.muted }]}>
              <TouchableOpacity
                style={[
                  styles.toggleOption,
                  txType === 'deposit' && styles.toggleActive,
                ]}
                onPress={() => setTxType('deposit')}
              >
                <Text
                  style={[
                    styles.toggleText,
                    { color: txType === 'deposit' ? '#0a1a10' : colors.mutedForeground },
                  ]}
                >
                  Deposit
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.toggleOption,
                  txType === 'disbursement' && styles.toggleActiveDisburse,
                ]}
                onPress={() => setTxType('disbursement')}
              >
                <Text
                  style={[
                    styles.toggleText,
                    { color: txType === 'disbursement' ? '#fff' : colors.mutedForeground },
                  ]}
                >
                  Disburse
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
              {isDeposit ? 'Add a Deposit' : 'Record a Disbursement'}
            </Text>

            {/* Amount */}
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Amount (KES)</Text>
            <TextInput
              style={[
                styles.input,
                {
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.muted,
                },
              ]}
              placeholder="e.g. 5000"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="numeric"
              value={amount}
              onChangeText={setAmount}
              returnKeyType="next"
            />

            {/* Description */}
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Description</Text>
            <TextInput
              style={[
                styles.input,
                {
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.muted,
                },
              ]}
              placeholder={isDeposit ? 'e.g. Monthly contribution' : 'e.g. School fees'}
              placeholderTextColor={colors.mutedForeground}
              value={description}
              onChangeText={setDescription}
              returnKeyType="done"
              onSubmitEditing={Keyboard.dismiss}
            />

            {/* Deposited by (deposits only) */}
            {isDeposit && members.length > 0 && (
              <>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Deposited by</Text>
                <View style={styles.memberRow}>
                  {members.map((m) => {
                    const isMe = m.userId === user?.id;
                    const selected = madeById === m.userId || (!madeById && isMe);
                    const name = m.userName?.split(' ')[0] ?? (isMe ? 'Me' : 'Member');
                    return (
                      <TouchableOpacity
                        key={m.userId}
                        style={[
                          styles.memberPill,
                          { backgroundColor: selected ? '#4ade80' : colors.muted, borderColor: selected ? '#4ade80' : colors.border },
                        ]}
                        onPress={() => setMadeById(m.userId)}
                        activeOpacity={0.7}
                      >
                        <Feather name="user" size={13} color={selected ? '#0a1a10' : colors.mutedForeground} />
                        <Text style={[styles.memberPillText, { color: selected ? '#0a1a10' : colors.foreground }]}>
                          {name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}

            {/* Expense category (disbursements only) */}
            {!isDeposit && (
              <>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Expense Category <Text style={{ fontWeight: '400' }}>(optional)</Text></Text>
                <TouchableOpacity
                  style={[styles.input, styles.pickerButton, { borderColor: colors.border, backgroundColor: colors.muted }]}
                  onPress={() => setShowCategoryPicker(!showCategoryPicker)}
                  activeOpacity={0.7}
                >
                  <Text style={{ color: expenseCategory ? colors.foreground : colors.mutedForeground, fontSize: 16, fontFamily: 'Inter_400Regular', flex: 1 }}>
                    {expenseCategory || 'Not linked to a category'}
                  </Text>
                  <Feather name={showCategoryPicker ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedForeground} />
                </TouchableOpacity>
                {showCategoryPicker && (
                  <View style={[styles.categoryDropdown, { borderColor: colors.border, backgroundColor: colors.card }]}>
                    <TouchableOpacity style={styles.categoryOption} onPress={() => { setExpenseCategory(''); setShowCategoryPicker(false); }}>
                      <Text style={{ color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>Not linked to a category</Text>
                    </TouchableOpacity>
                    {categories.map(c => (
                      <TouchableOpacity key={c.id} style={styles.categoryOption} onPress={() => { setExpenseCategory(c.name); setShowCategoryPicker(false); }}>
                        <Text style={{ color: colors.foreground, fontFamily: 'Inter_400Regular' }}>{c.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </>
            )}

            {/* Date */}
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Date</Text>
            <Pressable
              onPress={() => setShowDatePicker(true)}
              style={[styles.input, styles.pickerButton, { borderColor: colors.border, backgroundColor: colors.muted }]}
            >
              <Feather name="calendar" size={16} color={colors.mutedForeground} style={{ marginRight: 8 }} />
              <Text style={{ color: colors.foreground, fontSize: 16, fontFamily: 'Inter_400Regular', flex: 1 }}>
                {new Date(date + 'T00:00:00').toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}
              </Text>
              <Feather name="chevron-down" size={16} color={colors.mutedForeground} />
            </Pressable>
            {showDatePicker && (
              <DateTimePicker
                value={new Date(date + 'T00:00:00')}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                maximumDate={new Date()}
                onChange={(_event: DateTimePickerEvent, selected?: Date) => {
                  setShowDatePicker(Platform.OS === 'ios');
                  if (selected) {
                    const y = selected.getFullYear();
                    const m = String(selected.getMonth() + 1).padStart(2, '0');
                    const d = String(selected.getDate()).padStart(2, '0');
                    setDate(`${y}-${m}-${d}`);
                  }
                }}
              />
            )}

            {/* Submit */}
            <TouchableOpacity
              style={[
                styles.submitBtn,
                isDeposit ? styles.submitDeposit : styles.submitDisburse,
                submitting && { opacity: 0.6 },
              ]}
              onPress={handleSubmit}
              disabled={submitting}
              activeOpacity={0.85}
            >
              {submitting ? (
                <ActivityIndicator color={isDeposit ? '#0a1a10' : '#fff'} />
              ) : (
                <Text style={[styles.submitText, !isDeposit && { color: '#fff' }]}>
                  {isDeposit ? 'Deposit' : 'Disburse'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '700' as const,
    color: '#f7faf6',
    fontFamily: 'Inter_700Bold',
    marginBottom: 16,
  },
  balanceLabel: {
    fontSize: 12,
    color: '#7aaa8a',
    fontFamily: 'Inter_400Regular',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  balance: {
    fontSize: 36,
    fontWeight: '700' as const,
    color: '#f7faf6',
    fontFamily: 'Inter_700Bold',
    marginBottom: 20,
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 16,
    paddingVertical: 14,
    marginBottom: 16,
  },
  statItem: { flex: 1, alignItems: 'center', gap: 4 },
  statLabel: {
    fontSize: 11,
    color: '#7aaa8a',
    fontFamily: 'Inter_400Regular',
    letterSpacing: 0.5,
  },
  statValue: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: '#f7faf6',
    fontFamily: 'Inter_700Bold',
  },
  statDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.12)' },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#4ade80',
    borderRadius: 14,
    paddingVertical: 12,
  },
  actionBtnDisburse: {
    backgroundColor: 'rgba(248,113,113,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.4)',
  },
  actionBtnText: {
    fontSize: 15,
    fontWeight: '600' as const,
    fontFamily: 'Inter_600SemiBold',
    color: '#0a1a10',
  },
  actionBtnTextDisburse: {
    color: '#f87171',
  },
  list: { paddingHorizontal: 16, paddingTop: 16 },
  listHeader: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1,
    marginBottom: 10,
    marginLeft: 4,
  },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  txIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  txInfo: { flex: 1 },
  txDesc: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
  },
  txMeta: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  txAmount: {
    fontSize: 15,
    fontWeight: '600' as const,
    fontFamily: 'Inter_600SemiBold',
    marginLeft: 8,
  },
  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
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
  // Modal styles
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  modalWrapper: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  toggle: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
  },
  toggleOption: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 9,
  },
  toggleActive: {
    backgroundColor: '#4ade80',
  },
  toggleActiveDisburse: {
    backgroundColor: '#ef4444',
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '600' as const,
    fontFamily: 'Inter_600SemiBold',
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    fontFamily: 'Inter_700Bold',
    marginBottom: 20,
  },
  label: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    marginBottom: 16,
  },
  submitBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  submitDeposit: {
    backgroundColor: '#4ade80',
  },
  submitDisburse: {
    backgroundColor: '#ef4444',
  },
  submitText: {
    fontSize: 16,
    fontWeight: '700' as const,
    fontFamily: 'Inter_700Bold',
    color: '#0a1a10',
  },
  pickerButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
  },
  memberRow: {
    flexDirection: 'row' as const,
    gap: 10,
    marginBottom: 16,
  },
  memberPill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  memberPillText: {
    fontSize: 14,
    fontWeight: '600' as const,
    fontFamily: 'Inter_600SemiBold',
  },
  categoryDropdown: {
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 16,
    overflow: 'hidden' as const,
  },
  categoryOption: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
});
