import React, { useEffect, useState } from "react";
import { 
  View, 
  Text, 
  TouchableOpacity, 
  ScrollView, 
  Modal, 
  StyleSheet, 
  FlatList, 
  ActivityIndicator 
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { database, Vocabulary } from "@/scripts/VocabularyDB";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { Palette } from "@/constants/palette";

const PENDING_LESSON_WORD_KEY = "@pending_lesson_word";
const LESSON_NAVIGATION_KEY = "@lesson_navigation_context";

const LIMIT_PER_PAGE = 50;

export default function LessonScreen() {
  const [languages, setLanguages] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<{ [lang: string]: boolean }>({});
  const [levels, setLevels] = useState<{ [lang: string]: string[] }>({});
  
  // States cho Modal & Pagination
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string>("");
  const [selectedLevel, setSelectedLevel] = useState<string>("");
  const [selectedWords, setSelectedWords] = useState<Vocabulary[]>([]);
  
  const [offset, setOffset] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreData, setHasMoreData] = useState(true);

  const router = useRouter();

  useEffect(() => {
    database.getLanguages().then(setLanguages).catch(console.error);
  }, []);

  const handleWordPress = async (item: Vocabulary) => {
    try {
      // Lấy toàn bộ danh sách từ của level này (không phân trang, dùng limit lớn)
      const allWordsInLevel = await database.getWordsByLanguageAndLevel(
        item.language, 
        item.level ?? selectedLevel, 
        9999, 
        0
      );
      const currentIndex = allWordsInLevel.findIndex(w => w.id === item.id);

      await AsyncStorage.multiSet([
        [PENDING_LESSON_WORD_KEY, JSON.stringify({ 
          word: item.word, 
          id: item.id, 
          language: item.language,
          level: item.level ?? selectedLevel,
        })],
        [LESSON_NAVIGATION_KEY, JSON.stringify({
          words: allWordsInLevel,          // toàn bộ từ trong level
          currentIndex,
          language: item.language,
          level: item.level ?? selectedLevel,
        })],
      ]);

      setModalVisible(false);
      router.push("/(tabs)");
    } catch (e) {
      console.error("Lỗi lưu pending word:", e);
    }
  };

  const handleExpand = async (lang: string) => {
    setExpanded((prev) => ({ ...prev, [lang]: !prev[lang] }));
    if (!levels[lang]) {
      try {
        const lv = await database.getLevelsByLanguage(lang);
        setLevels((prev) => ({ ...prev, [lang]: lv }));
      } catch (error) {
        console.error("Lỗi lấy level:", error);
      }
    }
  };

  const handleLevelPress = async (lang: string, level: string) => {
    setSelectedLanguage(lang);
    setSelectedLevel(level);
    setOffset(0); 
    setHasMoreData(true); 
    setSelectedWords([]); 
    setModalVisible(true);

    try {
      // Đảm bảo hàm này trả về cả trường is_learned
      const words = await database.getWordsByLanguageAndLevel(lang, level, LIMIT_PER_PAGE, 0);
      setSelectedWords(words);
      if (words.length < LIMIT_PER_PAGE) setHasMoreData(false);
    } catch (error) {
      console.error("Lỗi lấy từ vựng:", error);
    }
  };

  const loadMoreWords = async () => {
    if (isLoadingMore || !hasMoreData) return;
    setIsLoadingMore(true);
    const nextOffset = offset + LIMIT_PER_PAGE;

    try {
      const newWords = await database.getWordsByLanguageAndLevel(selectedLanguage, selectedLevel, LIMIT_PER_PAGE, nextOffset);
      if (newWords.length > 0) {
        setSelectedWords((prev) => [...prev, ...newWords]);
        setOffset(nextOffset);
      }
      if (newWords.length < LIMIT_PER_PAGE) setHasMoreData(false);
    } catch (error) {
      console.error("Lỗi tải thêm data:", error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.containerContent} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>📖 Lessons</Text>
        </View>

        {languages.map((lang) => (
          <View key={lang} style={styles.card}>
            <TouchableOpacity
              style={styles.languageHeader}
              onPress={() => handleExpand(lang)}
              activeOpacity={0.7}
            >
              <Text style={styles.languageText}>{lang}</Text>
              <Ionicons
                name={expanded[lang] ? "chevron-up" : "chevron-down"}
                size={22}
                color={Palette.accent}
              />
            </TouchableOpacity>

            {expanded[lang] && (
              <View style={styles.levelList}>
                {levels[lang]?.map((level) => (
                  <TouchableOpacity
                    key={level}
                    style={styles.levelItem}
                    onPress={() => handleLevelPress(lang, level)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.levelText}>{level}</Text>
                    <Ionicons name="arrow-forward" size={16} color="#777" />
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        ))}
      </ScrollView>

      <Modal
        visible={modalVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} numberOfLines={1}>
                🔍 {selectedLanguage} - {selectedLevel}
              </Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Text style={styles.modalCloseIcon}>✕</Text>
              </TouchableOpacity>
            </View>

            {selectedWords.length === 0 && hasMoreData === false ? (
              <Text style={styles.emptyText}>Chưa có từ vựng nào.</Text>
            ) : (
              <FlatList
                style={styles.wordList}
                contentContainerStyle={styles.wordListContent}
                data={selectedWords}
                keyExtractor={(item, index) => item.id ? item.id.toString() : index.toString()}
                onEndReached={loadMoreWords}
                onEndReachedThreshold={0.5} 
                ListFooterComponent={
                  isLoadingMore ? (
                    <ActivityIndicator size="small" color={Palette.accent} style={{ marginVertical: 10 }} />
                  ) : null
                }
                initialNumToRender={15}
                maxToRenderPerBatch={20}
                windowSize={7}
                removeClippedSubviews={true}
                renderItem={({ item }) => {
                  const isLearned = item.is_learned === 1;
                  return (
                    <TouchableOpacity 
                      style={[styles.wordItem, isLearned && styles.wordItemLearned]} 
                      onPress={() => handleWordPress(item)} 
                      activeOpacity={0.7}
                    >
                      <View style={styles.wordMainInfo}>
                        <Text style={[styles.wordText, isLearned && styles.wordTextLearned]}>
                          {item.word}
                        </Text>
                        {isLearned && (
                          <View style={styles.badge}>
                            <Text style={styles.badgeText}>Learned</Text>
                          </View>
                        )}
                      </View>
                      <Ionicons 
                        name={isLearned ? "checkmark-circle" : "arrow-forward-circle-outline"} 
                        size={20} 
                        color={isLearned ? Palette.brand : Palette.textDim} 
                      />
                    </TouchableOpacity>
                  );
                }}
              />
            )}

            <TouchableOpacity style={styles.btnPrimary} onPress={() => setModalVisible(false)}>
              <Text style={styles.btnPrimaryText}>Đóng</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.bg },
  containerContent: { flexGrow: 1, paddingBottom: 24 },
  header: { alignItems: "center", paddingVertical: 20 },
  headerTitle: { fontSize: 26, fontWeight: "bold", color: Palette.accent },
  card: {
    backgroundColor: Palette.card, 
    borderRadius: 16, 
    padding: 16, 
    marginHorizontal: 16,
    marginBottom: 16,
    elevation: 6,
  },
  languageHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  languageText: { fontSize: 18, fontWeight: "bold", color: Palette.textPrimary },
  levelList: { paddingTop: 12, marginTop: 8, borderTopWidth: 1, borderTopColor: Palette.inset },
  levelItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: Palette.inset,
    marginBottom: 8,
  },
  levelText: { color: Palette.textPrimary, fontWeight: "600", fontSize: 15 },

  // MODAL STYLES
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.8)", 
    justifyContent: "center", 
    alignItems: "center", 
    padding: 20 
  },
  modalContent: {
    width: "100%",
    maxHeight: "85%",
    backgroundColor: Palette.card,
    borderRadius: 24,
    padding: 20,
  },
  modalHeader: { 
    flexDirection: "row", 
    alignItems: "center", 
    justifyContent: "space-between", 
    marginBottom: 20 
  },
  modalTitle: { 
    color: Palette.accent, 
    fontSize: 18, 
    fontWeight: "bold", 
    flex: 1 
  },
  modalCloseIcon: { color: Palette.textPrimary, fontSize: 22, fontWeight: "bold" },
  
  wordList: { flexShrink: 1, width: "100%", marginBottom: 16 },
  wordListContent: { paddingBottom: 10 },
  
  // WORD ITEM STYLES
  wordItem: {
    backgroundColor: Palette.inset,
    borderRadius: 12,
    padding: 15,
    marginBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderLeftWidth: 4,
    borderLeftColor: Palette.accent, // Màu vàng cho từ chưa học
  },
  wordItemLearned: {
    backgroundColor: "#112240", 
    borderLeftColor: Palette.brand, // Màu xanh cho từ đã học
    opacity: 0.7,
  },
  wordMainInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  wordText: { color: Palette.textPrimary, fontSize: 16, fontWeight: "700" },
  wordTextLearned: { color: "#94a3b8" },
  
  badge: {
    backgroundColor: "rgba(44, 201, 133, 0.15)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 10,
  },
  badgeText: {
    color: Palette.brand,
    fontSize: 10,
    fontWeight: "bold",
    textTransform: "uppercase",
  },

  emptyText: { color: Palette.textDim, textAlign: "center", paddingVertical: 20, fontStyle: "italic" },
  btnPrimary: { 
    backgroundColor: Palette.primary, 
    borderRadius: 12, 
    paddingVertical: 14, 
    alignItems: "center" 
  },
  btnPrimaryText: { color: Palette.textPrimary, fontWeight: "700", fontSize: 16 },
});