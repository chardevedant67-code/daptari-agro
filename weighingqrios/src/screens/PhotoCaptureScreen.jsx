import React, {useState} from 'react';
import {View, Text, StyleSheet, Pressable, Image, ActivityIndicator, Alert} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {launchCamera, launchImageLibrary} from 'react-native-image-picker';
import {useNavigation} from '../navigation/StackNavigator';
import {COLORS, SPACING, RADIUS, SHADOWS} from '../ui/theme';
import {BASE_URL} from '../config';

export default function PhotoCaptureScreen({route}) {
  const navigation       = useNavigation();
  const {sessionId}      = route?.params || {};
  const [photo, setPhoto]       = useState(null);
  const [uploading, setUploading] = useState(false);

  const openCamera = () => {
    launchCamera({mediaType:'photo', quality:0.8, saveToPhotos:false}, (res) => {
      if (res.didCancel || res.errorCode) return;
      setPhoto(res.assets?.[0]);
    });
  };

  const openGallery = () => {
    launchImageLibrary({mediaType:'photo', quality:0.8}, (res) => {
      if (res.didCancel || res.errorCode) return;
      setPhoto(res.assets?.[0]);
    });
  };

  const uploadAndNext = async () => {
    if (!photo) { Alert.alert('No Photo', 'Please capture a photo first.'); return; }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('photo', {
        uri:  photo.uri,
        name: photo.fileName || `seed_${Date.now()}.jpg`,
        type: photo.type || 'image/jpeg',
      });
      const res  = await fetch(`${BASE_URL}/api/sessions/${sessionId}/photo`, {
        method: 'POST', body: form,
        headers: {'Content-Type': 'multipart/form-data'},
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      navigation.push('WeighBefore', {sessionId, photoUrl: data.photoUrl});
    } catch (e) {
      Alert.alert('Upload Failed', e.message);
    } finally {
      setUploading(false);
    }
  };

  const skip = () => navigation.push('WeighBefore', {sessionId, photoUrl: ''});

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()} style={s.backBtn}>
          <Icon name="arrow-back" size={22} color={COLORS.text} />
        </Pressable>
        <View>
          <Text style={s.headerTitle}>Capture Photo</Text>
          <Text style={s.headerSub}>Step 1 of 4</Text>
        </View>
      </View>

      <View style={s.body}>
        {/* Progress bar */}
        <View style={s.progress}>
          {[1,2,3,4].map(n => (
            <View key={n} style={[s.progressDot, n === 1 && s.progressDotActive]} />
          ))}
        </View>

        <View style={s.photoBox}>
          {photo ? (
            <Image source={{uri: photo.uri}} style={s.preview} resizeMode="cover" />
          ) : (
            <View style={s.placeholder}>
              <Icon name="camera-alt" size={52} color={COLORS.textSecondary} />
              <Text style={s.placeholderTxt}>No photo taken yet</Text>
            </View>
          )}
        </View>

        <View style={s.btnRow}>
          <Pressable style={s.camBtn} onPress={openCamera}>
            <Icon name="camera-alt" size={20} color="#fff" />
            <Text style={s.camBtnTxt}>Camera</Text>
          </Pressable>
          <Pressable style={[s.camBtn, s.galleryBtn]} onPress={openGallery}>
            <Icon name="photo-library" size={20} color={COLORS.primary} />
            <Text style={[s.camBtnTxt, {color: COLORS.primary}]}>Gallery</Text>
          </Pressable>
        </View>

        {photo && (
          <Pressable style={s.retakeBtn} onPress={openCamera}>
            <Icon name="refresh" size={16} color={COLORS.textSecondary} />
            <Text style={s.retakeTxt}>Retake Photo</Text>
          </Pressable>
        )}

        <View style={s.footer}>
          <Pressable style={s.skipBtn} onPress={skip}>
            <Text style={s.skipTxt}>Skip</Text>
          </Pressable>
          <Pressable style={[s.nextBtn, !photo && s.nextBtnDisabled]} onPress={uploadAndNext} disabled={uploading}>
            {uploading
              ? <ActivityIndicator color="#fff" size="small" />
              : <><Text style={s.nextBtnTxt}>Next</Text><Icon name="arrow-forward" size={18} color="#fff" /></>
            }
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root:       {flex:1, backgroundColor:COLORS.background},
  header:     {flexDirection:'row', alignItems:'center', gap:12, paddingHorizontal:SPACING.md,
                paddingTop:SPACING.lg, paddingBottom:SPACING.sm},
  backBtn:    {width:36, height:36, borderRadius:18, backgroundColor:COLORS.surface,
                alignItems:'center', justifyContent:'center', ...SHADOWS.sm},
  headerTitle:{fontSize:18, fontWeight:'800', color:COLORS.text},
  headerSub:  {fontSize:12, color:COLORS.textSecondary, fontWeight:'500'},

  body:       {flex:1, padding:SPACING.md},
  progress:   {flexDirection:'row', gap:8, marginBottom:SPACING.md},
  progressDot:{flex:1, height:4, borderRadius:2, backgroundColor:COLORS.divider},
  progressDotActive:{backgroundColor:COLORS.primary},

  photoBox:   {borderRadius:RADIUS.lg, overflow:'hidden', backgroundColor:COLORS.surface,
                height:260, marginBottom:SPACING.md, ...SHADOWS.sm},
  preview:    {width:'100%', height:'100%'},
  placeholder:{flex:1, alignItems:'center', justifyContent:'center', gap:10},
  placeholderTxt:{fontSize:14, color:COLORS.textSecondary},

  btnRow:     {flexDirection:'row', gap:12, marginBottom:SPACING.sm},
  camBtn:     {flex:1, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8,
                backgroundColor:COLORS.primary, borderRadius:RADIUS.md, paddingVertical:14, ...SHADOWS.sm},
  galleryBtn: {backgroundColor:'#fff', borderWidth:1.5, borderColor:COLORS.primary},
  camBtnTxt:  {fontSize:15, fontWeight:'700', color:'#fff'},

  retakeBtn:  {flexDirection:'row', alignItems:'center', justifyContent:'center', gap:6, paddingVertical:8},
  retakeTxt:  {fontSize:13, color:COLORS.textSecondary},

  footer:     {flexDirection:'row', gap:12, marginTop:'auto', paddingTop:SPACING.md},
  skipBtn:    {flex:1, alignItems:'center', justifyContent:'center', paddingVertical:14,
                borderRadius:RADIUS.md, borderWidth:1.5, borderColor:COLORS.divider},
  skipTxt:    {fontSize:15, fontWeight:'600', color:COLORS.textSecondary},
  nextBtn:    {flex:2, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:6,
                backgroundColor:COLORS.primary, borderRadius:RADIUS.md, paddingVertical:14, ...SHADOWS.md},
  nextBtnDisabled:{opacity:0.5},
  nextBtnTxt: {fontSize:15, fontWeight:'700', color:'#fff'},
});
