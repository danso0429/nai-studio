import { FaQuestionCircle } from 'react-icons/fa';
import Tooltip from './Tooltip';

const HelpIcon = ({ content, size = 15 }: { content: string; size?: number }) => (
  <Tooltip content={content}>
    <span
      className="text-yellow-500 dark:text-yellow-400 cursor-help inline-flex items-center align-middle"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <FaQuestionCircle size={size} />
    </span>
  </Tooltip>
);

export default HelpIcon;
