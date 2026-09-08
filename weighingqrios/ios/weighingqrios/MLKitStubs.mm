// Stub implementations for MLKitCommon symbols missing from arm64 simulator slice.
// These are provided by the x86_64 slice but absent from the arm64 device slice
// that was patched to IOSSIMULATOR platform. Only compiled for simulator builds.
#if TARGET_OS_SIMULATOR

#include <string>
#include <cstring>
#include <cstdio>

// Mirror of abseil string_view ABI (ptr_, length_ in that order).
namespace MLKITx_absl {

class string_view {
public:
    const char* ptr_;
    size_t length_;

    string_view() : ptr_(nullptr), length_(0) {}
    string_view(const char* p, size_t l) : ptr_(p), length_(l) {}
    const char* data() const { return ptr_; }
    size_t size() const { return length_; }
    bool empty() const { return length_ == 0; }
    const char* begin() const { return ptr_; }
    const char* end() const { return ptr_ + length_; }
};

std::string BytesToHexString(string_view bytes) {
    static const char hex[] = "0123456789abcdef";
    std::string result;
    result.reserve(bytes.size() * 2);
    for (size_t i = 0; i < bytes.size(); i++) {
        unsigned char c = (unsigned char)bytes.ptr_[i];
        result += hex[c >> 4];
        result += hex[c & 0xf];
    }
    return result;
}

std::string CHexEscape(string_view src) {
    static const char hex[] = "0123456789abcdef";
    std::string result;
    result.reserve(src.size() * 4);
    for (size_t i = 0; i < src.size(); i++) {
        unsigned char c = (unsigned char)src.ptr_[i];
        if (c >= 32 && c < 127 && c != '\\' && c != '\'' && c != '"') {
            result += (char)c;
        } else {
            result += "\\x";
            result += hex[c >> 4];
            result += hex[c & 0xf];
        }
    }
    return result;
}

std::string CEscape(string_view src) {
    std::string result;
    result.reserve(src.size());
    for (size_t i = 0; i < src.size(); i++) {
        unsigned char c = (unsigned char)src.ptr_[i];
        switch (c) {
            case '\n': result += "\\n"; break;
            case '\r': result += "\\r"; break;
            case '\t': result += "\\t"; break;
            case '"':  result += "\\\""; break;
            case '\\': result += "\\\\"; break;
            default:
                if (c < 32 || c > 126) {
                    char buf[6];
                    snprintf(buf, sizeof(buf), "\\%03o", c);
                    result += buf;
                } else {
                    result += (char)c;
                }
        }
    }
    return result;
}

bool WebSafeBase64Escape(string_view src, std::string* dest) {
    if (!dest) return false;
    static const char kTable[] =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    dest->clear();
    const unsigned char* data = reinterpret_cast<const unsigned char*>(src.ptr_);
    size_t len = src.length_;
    dest->reserve(((len + 2) / 3) * 4);
    for (size_t i = 0; i < len; i += 3) {
        unsigned int v = (unsigned int)data[i] << 16;
        if (i + 1 < len) v |= (unsigned int)data[i + 1] << 8;
        if (i + 2 < len) v |= (unsigned int)data[i + 2];
        dest->push_back(kTable[(v >> 18) & 63]);
        dest->push_back(kTable[(v >> 12) & 63]);
        dest->push_back(i + 1 < len ? kTable[(v >> 6) & 63] : '=');
        dest->push_back(i + 2 < len ? kTable[v & 63] : '=');
    }
    return true;
}

bool WebSafeBase64Unescape(string_view src, std::string* dest) {
    if (!dest) return false;
    dest->clear();
    auto decode_char = [](char c) -> int {
        if (c >= 'A' && c <= 'Z') return c - 'A';
        if (c >= 'a' && c <= 'z') return c - 'a' + 26;
        if (c >= '0' && c <= '9') return c - '0' + 52;
        if (c == '-' || c == '+') return 62;
        if (c == '_' || c == '/') return 63;
        return -1;
    };
    const char* s = src.ptr_;
    size_t len = src.length_;
    for (size_t i = 0; i < len; ) {
        int v0 = i < len ? decode_char(s[i++]) : 0;
        int v1 = i < len ? decode_char(s[i++]) : 0;
        int v2 = i < len && s[i] != '=' ? decode_char(s[i++]) : (i++, -1);
        int v3 = i < len && s[i] != '=' ? decode_char(s[i++]) : (i++, -1);
        if (v0 < 0 || v1 < 0) break;
        dest->push_back((char)((v0 << 2) | (v1 >> 4)));
        if (v2 >= 0) dest->push_back((char)(((v1 & 0xf) << 4) | (v2 >> 2)));
        if (v3 >= 0) dest->push_back((char)(((v2 & 0x3) << 6) | v3));
    }
    return true;
}

bool CUnescape(string_view source, std::string* dest, std::string* error) {
    if (!dest) return false;
    dest->clear();
    const char* s = source.ptr_;
    size_t len = source.length_;
    for (size_t i = 0; i < len; i++) {
        if (s[i] != '\\') { dest->push_back(s[i]); continue; }
        if (++i >= len) {
            if (error) *error = "trailing backslash";
            return false;
        }
        switch (s[i]) {
            case 'n':  dest->push_back('\n'); break;
            case 'r':  dest->push_back('\r'); break;
            case 't':  dest->push_back('\t'); break;
            case '"':  dest->push_back('"');  break;
            case '\'': dest->push_back('\''); break;
            case '\\': dest->push_back('\\'); break;
            default:   dest->push_back('\\'); dest->push_back(s[i]); break;
        }
    }
    return true;
}

} // namespace MLKITx_absl

namespace MLKITx_strings {

long EscapeStrForCSV(const char* src, char* dest, long dest_len) {
    if (!src || !dest || dest_len <= 2) return -1;
    long out = 0;
    dest[out++] = '"';
    for (; *src && out < dest_len - 2; src++) {
        if (*src == '"') {
            if (out + 1 >= dest_len - 1) return -1;
            dest[out++] = '"';
        }
        dest[out++] = *src;
    }
    dest[out++] = '"';
    dest[out] = '\0';
    return out;
}

} // namespace MLKITx_strings

// C-linkage ABSLBuildData stubs missing from MLKitCommon arm64 simulator slice.
extern "C" {
  long long MLKITx_ABSLBuildDataGetChangelist(void) { return 0; }
}

#endif // TARGET_OS_SIMULATOR
