/** 開發用：一頁列出全部 108 張牌，確認 SVG 卡面與素材圖風格一致。 造訪 /?dev=cards */
import { buildDeck } from '@uno/shared';
import { UnoCard } from '../components/UnoCard.tsx';
import { Avatar, Badge, Button, Field, Icon, Panel, Toggle } from '../components/ui.tsx';
import { useState } from 'react';
import { AVATARS } from '@uno/shared';

export function CardGallery() {
  const deck = buildDeck();
  const [on, setOn] = useState(true);

  return (
    <div style={{ padding: 24, display: 'grid', gap: 24 }}>
      <h1 className="title-xl">卡牌素材檢查（{deck.length} 張）</h1>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        {deck.map((c) => (
          <UnoCard key={c.id} card={c} size="md" />
        ))}
        <UnoCard faceDown size="md" />
      </div>

      <h2 className="title-md">尺寸</h2>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
        <UnoCard card={deck[5]} size="xs" />
        <UnoCard card={deck[5]} size="sm" />
        <UnoCard card={deck[5]} size="md" />
        <UnoCard card={deck[5]} size="lg" />
        <UnoCard card={deck[30]} size="lg" playable />
        <UnoCard card={deck[40]} size="lg" dimmed />
      </div>

      <h2 className="title-md">按鈕</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <Button tone="gold" size="lg">開始遊戲</Button>
        <Button tone="green" size="lg">加入房間</Button>
        <Button tone="blue" size="lg">創建房間</Button>
        <Button tone="violet">邀請好友</Button>
        <Button tone="pink">離開房間</Button>
        <Button tone="gold">準備</Button>
        <Button tone="sky">取消</Button>
        <Button tone="ghost">說明</Button>
        <Button tone="pink" round>←</Button>
        <Button tone="green" round>✓</Button>
      </div>

      <h2 className="title-md">頭像與圖示</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {AVATARS.map((a) => (
          <Avatar key={a} id={a} size="lg" />
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {(['trophy', 'gear', 'sound', 'music', 'mic', 'help', 'users', 'chat', 'alert', 'clock', 'wifi', 'exit', 'shield', 'crown', 'star', 'gift', 'shop', 'store'] as const).map((n) => (
          <Icon key={n} name={n} size={32} />
        ))}
      </div>

      <h2 className="title-md">面板</h2>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Panel title="創建房間" className="" footer={<Button tone="green">創建</Button>}>
          <Field label="房間名稱"><input type="text" placeholder="輸入房間名稱" /></Field>
          <Field label="最大玩家">
            <select defaultValue="4"><option>2</option><option>3</option><option>4</option></select>
          </Field>
          <Field label="允許 AI"><Toggle checked={on} onChange={setOn} /></Field>
          <Field label="房主"><Badge tone="gold">房主</Badge></Field>
        </Panel>
      </div>
    </div>
  );
}
