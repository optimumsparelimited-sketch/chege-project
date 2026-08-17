import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Platform,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/lib/auth';

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const handleLogout = () => {
    Alert.alert(
      'Sign out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: async () => {
            setLoggingOut(true);
            try {
              await logout();
            } catch {
              Alert.alert('Error', 'Could not sign out. Please try again.');
              setLoggingOut(false);
            }
          },
        },
      ],
    );
  };

  const displayName =
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Family Member';
  const initials = displayName
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          { paddingTop: topPad + 12, backgroundColor: colors.card, borderBottomColor: colors.border },
        ]}
      >
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Settings</Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Platform.OS === 'web' ? 100 : insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile card */}
        <View style={[styles.profileCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {user?.profileImageUrl ? (
            <Image
              source={{ uri: user.profileImageUrl }}
              style={styles.avatar}
            />
          ) : (
            <View style={[styles.avatarFallback, { backgroundColor: colors.primary + '22' }]}>
              <Text style={[styles.avatarInitials, { color: colors.primary }]}>{initials}</Text>
            </View>
          )}
          <View style={styles.profileInfo}>
            <Text style={[styles.profileName, { color: colors.foreground }]}>{displayName}</Text>
            {user?.email ? (
              <Text style={[styles.profileEmail, { color: colors.mutedForeground }]}>{user.email}</Text>
            ) : null}
          </View>
        </View>

        {/* Account section */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>ACCOUNT</Text>
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.row, { borderBottomColor: colors.border }]}>
            <View style={styles.rowLeft}>
              <View style={[styles.rowIcon, { backgroundColor: colors.primary + '18' }]}>
                <Feather name="user" size={16} color={colors.primary} />
              </View>
              <Text style={[styles.rowLabel, { color: colors.foreground }]}>Name</Text>
            </View>
            <Text style={[styles.rowValue, { color: colors.mutedForeground }]}>{displayName}</Text>
          </View>
          {user?.email ? (
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <View style={[styles.rowIcon, { backgroundColor: colors.primary + '18' }]}>
                  <Feather name="mail" size={16} color={colors.primary} />
                </View>
                <Text style={[styles.rowLabel, { color: colors.foreground }]}>Email</Text>
              </View>
              <Text style={[styles.rowValue, { color: colors.mutedForeground }]} numberOfLines={1}>
                {user.email}
              </Text>
            </View>
          ) : null}
        </View>

        {/* App section */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>APP</Text>
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.row, { borderBottomColor: colors.border }]}>
            <View style={styles.rowLeft}>
              <View style={[styles.rowIcon, { backgroundColor: '#1a3320' }]}>
                <Feather name="users" size={16} color="#4ade80" />
              </View>
              <Text style={[styles.rowLabel, { color: colors.foreground }]}>Household</Text>
            </View>
            <Text style={[styles.rowValue, { color: colors.mutedForeground }]}>Chege &amp; Lydiah</Text>
          </View>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={[styles.rowIcon, { backgroundColor: colors.muted }]}>
                <Feather name="smartphone" size={16} color={colors.mutedForeground} />
              </View>
              <Text style={[styles.rowLabel, { color: colors.foreground }]}>Platform</Text>
            </View>
            <Text style={[styles.rowValue, { color: colors.mutedForeground }]}>
              {Platform.OS === 'ios' ? 'iOS' : Platform.OS === 'android' ? 'Android' : 'Web'}
            </Text>
          </View>
        </View>

        {/* Sign out */}
        <Pressable
          onPress={handleLogout}
          disabled={loggingOut}
          style={({ pressed }) => [
            styles.signOutBtn,
            { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed || loggingOut ? 0.6 : 1 },
          ]}
        >
          <Feather name="log-out" size={18} color="#ef4444" />
          <Text style={styles.signOutText}>{loggingOut ? 'Signing out…' : 'Sign out'}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 22, fontWeight: '700', fontFamily: 'Inter_700Bold' },

  content: { paddingHorizontal: 16, paddingTop: 20, gap: 4 },

  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 20,
  },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  avatarFallback: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitials: { fontSize: 20, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 17, fontWeight: '600', fontFamily: 'Inter_600SemiBold' },
  profileEmail: { fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 2 },

  sectionLabel: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    letterSpacing: 0.8,
    marginTop: 16,
    marginBottom: 6,
    marginLeft: 4,
  },
  section: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderBottomWidth: 1,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowIcon: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: 15, fontFamily: 'Inter_400Regular' },
  rowValue: { fontSize: 14, fontFamily: 'Inter_400Regular', maxWidth: 180 },

  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 28,
    padding: 15,
    borderRadius: 14,
    borderWidth: 1,
  },
  signOutText: { fontSize: 16, fontWeight: '600', fontFamily: 'Inter_600SemiBold', color: '#ef4444' },
});
