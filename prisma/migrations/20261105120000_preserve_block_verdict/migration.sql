-- Preserve AI duplicate BLOCK independently from review HOLD.
ALTER TABLE `Verification`
  MODIFY COLUMN `riskStatus` ENUM('PASS', 'WARN', 'HOLD', 'BLOCK') NULL;

-- Repair historical values only when the original AI verdict explicitly was BLOCK.
UPDATE `Verification`
SET `riskStatus` = 'BLOCK'
WHERE `riskStatus` = 'HOLD'
  AND `source` = 'AI'
  AND JSON_UNQUOTE(JSON_EXTRACT(`evidence`, '$.decision')) = 'BLOCK';
