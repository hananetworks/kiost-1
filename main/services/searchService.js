// searchService.js (네이버 블로그 검색)
const axios = require('axios');

/**
 * 네이버 블로그 검색 API를 사용하여 웹 정보를 검색합니다.
 * (AI가 날씨 등 내부 지식에 없는 정보를 물어볼 때 사용)
 */
async function search_web_for_info({ query }) {
    try {
        const apiUrl = `https://openapi.naver.com/v1/search/blog.json?query=${encodeURI(query)}&display=3`; // 3개 결과
        const response = await axios.get(apiUrl, {
            headers: {
                'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
                'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
            },
        });

        if (response.data.items && response.data.items.length > 0) {
            // HTML 태그를 제거하고 검색 결과(description)를 조합
            const snippets = response.data.items
                .map(item => item.description.replace(/<[^>]*>?/gm, ''))
                .join('\n\n');
            return JSON.stringify({ searchResults: snippets });
        } else {
            return JSON.stringify({ searchResults: "관련 정보를 찾을 수 없습니다." });
        }
    } catch (error) {
        console.error('웹 검색 실패:', error.response ? error.response.data : error.message);
        return JSON.stringify({ error: '웹 검색 중 오류가 발생했습니다.' });
    }
}

module.exports = { search_web_for_info };