import React from 'react';
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {useDispatch, useSelector} from 'react-redux';
import {clearNotifications, markAllRead} from '../../store/slices/notificationSlice';
import {COLORS, RADIUS, SHADOWS, SPACING} from '../theme';

const TYPE_CONFIG = {
  PASS: {icon: 'check-circle', color: '#16a34a', bg: '#dcfce7'},
  WARN: {icon: 'warning',      color: '#ca8a04', bg: '#fef9c3'},
  FAIL: {icon: 'cancel',       color: '#dc2626', bg: '#fee2e2'},
  INFO: {icon: 'info',         color: COLORS.primary, bg: COLORS.track},
};

function formatTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
}

export default function NotificationPanel({visible, onClose}) {
  const dispatch = useDispatch();
  const list = useSelector(s => s.notifications.list);

  const handleOpen = () => {
    dispatch(markAllRead());
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onShow={handleOpen}
      onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        {/* Handle */}
        <View style={styles.handle} />

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Notifications</Text>
          <View style={styles.headerRight}>
            {list.length > 0 && (
              <Pressable
                style={styles.clearBtn}
                onPress={() => dispatch(clearNotifications())}>
                <Text style={styles.clearTxt}>Clear all</Text>
              </Pressable>
            )}
            <Pressable style={styles.closeBtn} onPress={onClose}>
              <Icon name="close" size={20} color={COLORS.muted} />
            </Pressable>
          </View>
        </View>

        {/* List */}
        {list.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="notifications-none" size={48} color={COLORS.muted} />
            <Text style={styles.emptyTxt}>No notifications yet</Text>
            <Text style={styles.emptySub}>Weighing results will appear here</Text>
          </View>
        ) : (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}>
            {list.map(item => {
              const cfg = TYPE_CONFIG[item.type] || TYPE_CONFIG.INFO;
              return (
                <View key={item.id} style={[styles.item, !item.read && styles.itemUnread]}>
                  <View style={[styles.iconCircle, {backgroundColor: cfg.bg}]}>
                    <Icon name={cfg.icon} size={22} color={cfg.color} />
                  </View>
                  <View style={styles.itemContent}>
                    <Text style={styles.itemTitle}>{item.title}</Text>
                    <Text style={styles.itemBody}>{item.body}</Text>
                    <Text style={styles.itemTime}>{formatTime(item.time)}</Text>
                  </View>
                  {!item.read && <View style={styles.unreadDot} />}
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '75%',
    paddingBottom: 32,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: COLORS.border,
    alignSelf: 'center',
    marginTop: 10, marginBottom: 4,
  },
  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  title: {fontSize: 17, fontWeight: '800', color: COLORS.text},
  headerRight: {flexDirection: 'row', alignItems: 'center', gap: SPACING.sm},
  clearBtn: {
    paddingHorizontal: 12, paddingVertical: 5,
    backgroundColor: COLORS.track, borderRadius: RADIUS.pill,
  },
  clearTxt: {fontSize: 12, fontWeight: '700', color: COLORS.primary},
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: COLORS.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  scroll: {flex: 1},
  scrollContent: {padding: SPACING.md, gap: SPACING.sm},
  item: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.md, padding: SPACING.md,
    borderWidth: 1, borderColor: COLORS.border,
    gap: SPACING.md, ...SHADOWS.card,
  },
  itemUnread: {borderColor: COLORS.primary, borderWidth: 1.5},
  iconCircle: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  itemContent: {flex: 1},
  itemTitle: {fontSize: 14, fontWeight: '700', color: COLORS.text, marginBottom: 2},
  itemBody: {fontSize: 13, color: COLORS.muted, marginBottom: 4},
  itemTime: {fontSize: 11, color: COLORS.labelMuted, fontWeight: '500'},
  unreadDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: COLORS.primary,
    marginTop: 4,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: SPACING.sm,
  },
  emptyTxt: {fontSize: 16, fontWeight: '700', color: COLORS.muted},
  emptySub: {fontSize: 13, color: COLORS.labelMuted},
});
