import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator, Image, Modal, PanResponder, Pressable, StyleSheet, Text, View,
} from 'react-native';
import {COLORS, RADIUS, SPACING} from '../theme';

const MIN_SIZE = 48;   // smallest crop box edge (px, on screen)
const HANDLE = 44;     // touch target of each corner handle

// Lets the user frame the weighing-machine display on a just-captured photo,
// so the OCR only sees that area - at whatever distance the phone was held.
// The box needs some room beside the digits: the reader refuses a row of
// digits that reaches the edge, because a digit could be hidden beyond it.
// No fixed coordinates: the box starts where the display was detected
// (initialCrop, fractions of the photo) or, without a detection, as a wide
// strip in the middle, and is dragged/resized by the user. onConfirm receives
// the box as fractions (0..1) of the photo: {x, y, w, h}. `notice` says why
// the user is being asked to frame the display.
export default function DisplayCropModal({visible, uri, initialCrop, notice, onConfirm, onCancel}) {
  const [layout, setLayout] = useState(null);     // {w, h} of the image area
  const [imgSize, setImgSize] = useState(null);   // {w, h} of the photo itself
  const [box, setBox] = useState(null);           // crop box, screen px

  const boxRef = useRef(null);
  const boundsRef = useRef(null);
  const startRef = useRef(null);

  useEffect(() => {
    setImgSize(null); setBox(null);
    if (!visible || !uri) return;
    Image.getSize(uri, (w, h) => setImgSize({w, h}), () => setImgSize({w: 0, h: 0}));
  }, [visible, uri]);

  // Rectangle the photo occupies inside the image area (resizeMode contain).
  const bounds = useMemo(() => {
    if (!layout || !imgSize || !imgSize.w) return null;
    const s = Math.min(layout.w / imgSize.w, layout.h / imgSize.h);
    const w = imgSize.w * s;
    const h = imgSize.h * s;
    return {x: (layout.w - w) / 2, y: (layout.h - h) / 2, w, h};
  }, [layout, imgSize]);

  useEffect(() => {
    boundsRef.current = bounds;
    if (!bounds) return;
    const c = initialCrop || {x: 0.06, y: 0.30, w: 0.88, h: 0.40};
    // never smaller than the handles can grab, never outside the photo
    const w = Math.min(bounds.w, Math.max(MIN_SIZE, bounds.w * c.w));
    const h = Math.min(bounds.h, Math.max(MIN_SIZE, bounds.h * c.h));
    const initial = {
      x: Math.min(Math.max(bounds.x + bounds.w * c.x, bounds.x), bounds.x + bounds.w - w),
      y: Math.min(Math.max(bounds.y + bounds.h * c.y, bounds.y), bounds.y + bounds.h - h),
      w,
      h,
    };
    boxRef.current = initial;
    setBox(initial);
  }, [bounds, initialCrop]);

  const apply = useCallback((kind, dx, dy) => {
    const b = boundsRef.current;
    const s = startRef.current;
    if (!b || !s) return;
    let l = s.x; let t = s.y; let r = s.x + s.w; let bt = s.y + s.h;
    if (kind === 'move') {
      const nx = Math.min(Math.max(s.x + dx, b.x), b.x + b.w - s.w);
      const ny = Math.min(Math.max(s.y + dy, b.y), b.y + b.h - s.h);
      l = nx; t = ny; r = nx + s.w; bt = ny + s.h;
    } else {
      if (kind.includes('l')) l = Math.min(Math.max(s.x + dx, b.x), r - MIN_SIZE);
      if (kind.includes('r')) r = Math.max(Math.min(r + dx, b.x + b.w), l + MIN_SIZE);
      if (kind.includes('t')) t = Math.min(Math.max(s.y + dy, b.y), bt - MIN_SIZE);
      if (kind.includes('b')) bt = Math.max(Math.min(bt + dy, b.y + b.h), t + MIN_SIZE);
    }
    const next = {x: l, y: t, w: r - l, h: bt - t};
    boxRef.current = next;
    setBox(next);
  }, []);

  const responders = useMemo(() => {
    const make = kind => PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => { startRef.current = {...boxRef.current}; },
      onPanResponderMove: (_, g) => apply(kind, g.dx, g.dy),
    });
    return {move: make('move'), tl: make('tl'), tr: make('tr'), bl: make('bl'), br: make('br')};
  }, [apply]);

  const confirm = () => {
    const b = boundsRef.current;
    const c = boxRef.current;
    if (!b || !c) return;
    onConfirm({
      x: (c.x - b.x) / b.w,
      y: (c.y - b.y) / b.h,
      w: c.w / b.w,
      h: c.h / b.h,
    });
  };

  const corner = (kind, style) => (
    <View style={[styles.handle, style]} {...responders[kind].panHandlers}>
      <View style={styles.handleDot} />
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View style={styles.root}>
        <Text style={styles.title}>Frame the weight display</Text>
        {!!notice && <Text style={styles.notice}>{notice}</Text>}
        <Text style={styles.sub}>
          Drag the box around the whole weight display: every digit and the decimal point, with a little space on each side. Leave out buttons and stickers.
        </Text>

        <View style={styles.imageArea} onLayout={e => setLayout({
          w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height,
        })}>
          {!!uri && <Image source={{uri}} style={StyleSheet.absoluteFill} resizeMode="contain" />}
          {!bounds && <ActivityIndicator color="#fff" style={StyleSheet.absoluteFill} />}
          {bounds && box && (
            <>
              {/* dim everything outside the box */}
              <View style={[styles.dim, {left: bounds.x, top: bounds.y, width: bounds.w, height: box.y - bounds.y}]} />
              <View style={[styles.dim, {left: bounds.x, top: box.y + box.h, width: bounds.w, height: bounds.y + bounds.h - box.y - box.h}]} />
              <View style={[styles.dim, {left: bounds.x, top: box.y, width: box.x - bounds.x, height: box.h}]} />
              <View style={[styles.dim, {left: box.x + box.w, top: box.y, width: bounds.x + bounds.w - box.x - box.w, height: box.h}]} />

              <View
                style={[styles.box, {left: box.x, top: box.y, width: box.w, height: box.h}]}
                {...responders.move.panHandlers}
              />
              {corner('tl', {left: box.x - HANDLE / 2, top: box.y - HANDLE / 2})}
              {corner('tr', {left: box.x + box.w - HANDLE / 2, top: box.y - HANDLE / 2})}
              {corner('bl', {left: box.x - HANDLE / 2, top: box.y + box.h - HANDLE / 2})}
              {corner('br', {left: box.x + box.w - HANDLE / 2, top: box.y + box.h - HANDLE / 2})}
            </>
          )}
        </View>

        <View style={styles.row}>
          <Pressable style={[styles.btn, styles.btnGhost]} onPress={onCancel}>
            <Text style={styles.btnGhostTxt}>Cancel</Text>
          </Pressable>
          <Pressable style={[styles.btn, !box && {opacity: 0.4}]} disabled={!box} onPress={confirm}>
            <Text style={styles.btnTxt}>Read Weight</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root:      {flex: 1, backgroundColor: '#0f172a', padding: SPACING.lg, paddingTop: SPACING.xl},
  title:     {fontSize: 17, fontWeight: '700', color: '#fff', textAlign: 'center'},
  sub:       {fontSize: 12, color: 'rgba(255,255,255,0.7)', textAlign: 'center', marginTop: 4, marginBottom: SPACING.md},
  notice:    {fontSize: 13, color: '#fbbf24', textAlign: 'center', marginTop: 4},
  imageArea: {flex: 1, backgroundColor: '#000'},
  dim:       {position: 'absolute', backgroundColor: 'rgba(0,0,0,0.55)'},
  box:       {position: 'absolute', borderWidth: 2, borderColor: COLORS.primary},
  handle:    {position: 'absolute', width: HANDLE, height: HANDLE, alignItems: 'center', justifyContent: 'center'},
  handleDot: {width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff', borderWidth: 2, borderColor: COLORS.primary},
  row:       {flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md},
  btn:       {flex: 1, height: 48, borderRadius: RADIUS.md, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center'},
  btnTxt:    {color: '#fff', fontSize: 15, fontWeight: '700'},
  btnGhost:  {backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)'},
  btnGhostTxt: {color: '#fff', fontSize: 15, fontWeight: '700'},
});
