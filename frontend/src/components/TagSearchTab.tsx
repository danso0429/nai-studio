import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  FaSearch,
  FaTag,
  FaPaintBrush,
  FaBook,
  FaDatabase,
  FaBox,
} from 'react-icons/fa';
import { FaPerson } from 'react-icons/fa6';
import { backend } from '../models';
import { appState } from '../models/AppService';

// db.csv category(정수) → 아이콘. PromptEditTextArea 자동완성과 동일 매핑.
const categoryIcon = (category: number) => {
  if (category === 0) return <FaTag />;
  if (category === 1) return <FaPaintBrush />;
  if (category === 3) return <FaBook />;
  if (category === 4) return <FaPerson />;
  if (category === 5) return <FaDatabase />;
  return <FaBox />;
};

// 학습량(freq) 표기 — 자동완성과 동일.
const formatCount = (count: number) => {
  if (count > 1000) return (count / 1000).toFixed(1) + 'k';
  return String(count);
};

const copyTag = async (word: string) => {
  try {
    await navigator.clipboard.writeText(word);
    appState.pushMessage(`복사됨: ${word}`);
  } catch (e) {
    appState.pushMessage('복사 실패');
  }
};

const TagSearchTab = observer(() => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const cntRef = useRef(0);

  // 입력 디바운스(250ms) 후 서버 full 검색. 최신 요청만 반영(cntRef 가드).
  useEffect(() => {
    const q = query.trim();
    // cntRef를 항상 올려 직전 in-flight 요청을 무효화(빈 쿼리로 지웠는데 옛 응답이
    // 돌아와 stale 결과가 뜨는 것 방지).
    const myId = ++cntRef.current;
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const tags = await backend.searchTagsFull(q, 200);
        if (myId !== cntRef.current) return; // 더 최신 요청이 있으면 폐기
        setResults(Array.isArray(tags) ? tags : []);
      } catch (e) {
        if (myId === cntRef.current) setResults([]);
      } finally {
        if (myId === cntRef.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div className="flex flex-col h-full w-full p-2 gap-2">
      <div className="flex-none">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
            <FaSearch />
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="태그 검색"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-slate-500 bg-white dark:bg-slate-700 text-default focus:outline-none focus:border-sky-400"
          />
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 px-1">
          {query.trim() === ''
            ? 'db.csv 태그를 검색해요. 오른쪽 숫자 = 학습량. 태그를 누르면 복사돼요.'
            : loading
              ? '검색 중…'
              : `${results.length}개${results.length >= 200 ? '+' : ''} 결과 (학습량순)`}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto rounded-lg border border-gray-200 dark:border-slate-600">
        {results.length === 0 && query.trim() !== '' && !loading ? (
          <div className="p-4 text-center text-sm text-gray-400">
            일치하는 태그가 없어요.
          </div>
        ) : (
          results.map((tag, idx) => (
            <div
              key={idx}
              onClick={() => copyTag(tag.word)}
              className="flex items-center p-2 gap-2 cursor-pointer hover:brightness-95 active:brightness-90 border-b border-gray-100 dark:border-slate-700 last:border-b-0"
            >
              <span className="text-gray-600 dark:text-gray-300 flex-none">
                {categoryIcon(tag.category)}
              </span>
              <span className="flex-1 truncate text-sm text-default">
                {tag.word}
              </span>
              {tag.freq > 0 && (
                <span className="flex-none text-xs text-gray-500 dark:text-gray-400">
                  {formatCount(tag.freq)}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
});

export default TagSearchTab;
