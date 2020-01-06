/* global readline print printErr
 */
/* eslint-env node */

const CARD_LOCATIONS = {
  OPPONENT_BOARD: '-1',
  PLAYER_HAND: '0',
  PLAYER_BOARD: '1',
  OUT_OF_PLAY: '2'
};

const CARD_TYPES = {
  CREATURE: '0',
  GREEN_ITEM: '1',
  RED_ITEM: '2',
  BLUE_ITEM: '3'
};

const ACTION_TYPES = {
  PASS: 'O',
  SUMMON: '1',
  ATTACK: '2',
  USE: '3',
  PICK: '4'
};

const TIME_TO_THINK_IN_MS = 96;

const PLAYER_CREATURE_ATTACK_WEIGHT = 0.9;
const PLAYER_CREATURE_DEFENSE_WEIGHT = 0.9;
const OPPONENT_CREATURE_ATTACK_WEIGHT = 1;
const OPPONENT_CREATURE_DEFENSE_WEIGHT = 1;
const PLAYER_HAND_MANA_COST_WEIGHT = 0.1;
const PLAYER_HEALTH_WEIGHT = 0.1;
const OPPONENT_HEALTH_WEIGHT = 0.1;
const PLAYER_WINS_WEIGHT = 1.2;
const OPPONENT_WINS_WEIGHT = 0.5;
const GUARD_WEIGHT = 1;
const LETHAL_WEIGHT = 3;
const WARD_WEIGHT = 2;

const MAX_CARDS_ON_BOARD = 6;

class Participant {
  constructor(health, mana, deckCardsRemaining, rune, cardDraw) {
    this.health = health || 30;
    this.mana = mana || 0;
    this.deckCardsRemaining = deckCardsRemaining || 0;
    this.rune = rune || 25;
    this.cardDraw = cardDraw || 0;
  }

  read() {
    const inputs = readline().split(' ');
    this.health = parseInt(inputs[0]);
    this.mana = parseInt(inputs[1]);
    this.deckCardsRemaining = parseInt(inputs[2]);
    this.rune = parseInt(inputs[3]);
  }
}

class Card {
  constructor(number, instanceId, location, type, cost, attack, defense, breakthrough, charge, drain, guard, lethal, ward, playerHealthChange, opponentHealthChange, draw, used, canAttack) {
    this.number = number || -1;
    this.instanceId = instanceId || -1;
    this.location = location || -1;
    this.type = type || CARD_TYPES.CREATURE;
    this.cost = cost || 0;
    this.attack = attack || 0;
    this.defense = defense || 0;
    this.breakthrough = breakthrough || false;
    this.charge = charge || false;
    this.drain = drain || false;
    this.guard = guard || false;
    this.lethal = lethal || false;
    this.ward = ward || false;
    this.playerHealthChange = playerHealthChange || 0;
    this.opponentHealthChange = opponentHealthChange || 0;
    this.draw = draw || 0;

    this.used = used || false;
    this.canAttack = canAttack || false;
  }

  read() {
    const inputs = readline().split(' ');
    this.number = parseInt(inputs[0]);
    this.instanceId = parseInt(inputs[1]);
    this.location = inputs[2];
    this.type = inputs[3];
    this.cost = parseInt(inputs[4]);
    this.attack = parseInt(inputs[5]);
    this.defense = parseInt(inputs[6]);
    const abilities = inputs[7];
    if (typeof abilities !== 'undefined') {
      this.breakthrough = abilities[0] === 'B';
      this.charge = abilities[1] === 'C';
      this.drain = abilities[2] === 'D';
      this.guard = abilities[3] === 'G';
      this.lethal = abilities[4] === 'L';
      this.ward = abilities[5] === 'W';
    }
    this.playerHealthChange = parseInt(inputs[8]);
    this.opponentHealthChange = parseInt(inputs[9]);
    this.draw = parseInt(inputs[10]);

    this.canAttack = this.location === CARD_LOCATIONS.PLAYER_BOARD;
  }

  shouldCardScoreBeMultiplied(manaCurve) {
    if (this.type !== CARD_TYPES.CREATURE) {
      return false;
    }
    switch (this.cost) {
      case 0:
      case 1:
        return manaCurve['0-1'] > 0;
      case 2:
        return manaCurve['2'] > 0;
      case 3:
        return manaCurve['3'] > 0;
      case 4:
        return manaCurve['4'] > 0;
      case 5:
        return manaCurve['5'] > 0;
      case 6:
        return manaCurve['6'] > 0;
      default: // 7+
        return manaCurve['7+'] > 0;
    }
  }
}

class Action {
  constructor(type, sourceInstanceId, targetInstanceId, msg) {
    this.type = type || ACTION_TYPES.PASS;
    this.sourceInstanceId = sourceInstanceId || -1;
    this.targetInstanceId = targetInstanceId || -1;
    this.msg = msg || '';
  }

  pass(msg) {
    this.type = ACTION_TYPES.PASS;
    this.msg = msg;
  }

  summon(sourceInstanceId, msg) {
    this.type = ACTION_TYPES.SUMMON;
    this.sourceInstanceId = sourceInstanceId;
    this.msg = msg;
  }

  attack(sourceInstanceId, targetInstanceId, msg) {
    this.type = ACTION_TYPES.ATTACK;
    this.sourceInstanceId = sourceInstanceId;
    if (targetInstanceId) {
      this.targetInstanceId = targetInstanceId;
    }
    this.msg = msg;
  }

  use(sourceInstanceId, targetInstanceId, msg) {
    this.type = ACTION_TYPES.USE;
    this.sourceInstanceId = sourceInstanceId;
    if (targetInstanceId) {
      this.targetInstanceId = targetInstanceId;
    }
    this.msg = msg;
  }

  pick(sourceInstanceId, msg) {
    this.type = ACTION_TYPES.PICK;
    this.sourceInstanceId = sourceInstanceId;
    this.msg = msg;
  }

  write(outputArray) {
    switch (this.type) {
      case ACTION_TYPES.SUMMON:
        outputArray.push(`SUMMON ${this.sourceInstanceId}${this.msg ? ` ${this.msg}` : ''};`);
        break;
      case ACTION_TYPES.ATTACK:
        outputArray.push(`ATTACK ${this.sourceInstanceId} ${this.targetInstanceId}${this.msg ? ` ${this.msg}` : ''};`);
        break;
      case ACTION_TYPES.USE:
        outputArray.push(`USE ${this.sourceInstanceId} ${this.targetInstanceId}${this.msg ? ` ${this.msg}` : ''};`);
        break;
      case ACTION_TYPES.PICK:
        outputArray.push(`PICK ${this.sourceInstanceId}${this.msg ? ` ${this.msg}` : ''};`);
        break;
      default: // ACTION_TYPES.PASS
        outputArray.push(`PASS${this.msg.length > 0 ? ` ${this.msg}` : ''}`);
        break;
    }
  }
}

class State {
  constructor(player, opponent, opponentHandSize, cards, actions, randomAction) {
    this.player = player || new Participant();
    this.opponent = opponent || new Participant();
    this.opponentHandSize = opponentHandSize || 0;
    this.cards = cards || [];
    this.actions = actions || [];
    this.randomAction = randomAction || new Action();
  }

  deepClone() {
    const newState = new State();
    newState.player = Object.assign({}, this.player);
    newState.opponent = Object.assign({}, this.opponent);
    newState.opponentHandSize = this.opponentHandSize;
    for (let card of this.cards) {
      newState.cards.push(Object.assign({}, card));
    }
    for (let action of this.actions) {
      const newAction = new Action(action.type, action.sourceInstanceId, action.targetInstanceId, action.msg);
      newState.actions.push(newAction);
    }
    newState.randomAction.type = this.randomAction.type;
    newState.randomAction.sourceInstanceId = this.randomAction.sourceInstanceId;
    newState.randomAction.targetInstanceId = this.randomAction.targetInstanceId;
    newState.randomAction.msg = this.randomAction.msg;

    return newState;
  }

  isInDraft() {
    return this.player.mana === 0;
  }

  read() {
    const participants = [];
    for (let i = 0; i < 2; i++) {
      const participant = new Participant();
      participant.read();
      participants.push(participant);
    }
    this.player = participants[0];
    this.opponent = participants[1];
    this.opponentHandSize = parseInt(readline());
    const cardCount = parseInt(readline());
    this.cards = [];
    for (let i = 0; i < cardCount; i++) {
      const card = new Card();
      card.read();
      this.cards.push(card);
    }
  }

  updateAction(action, isPlayerTurn, debug) {
    const opponentBoard = this.cards.filter((card) => card.location === CARD_LOCATIONS.OPPONENT_BOARD);
    const playerBoard = this.cards.filter((card) => card.location === CARD_LOCATIONS.PLAYER_BOARD);

    let cardToSummon = new Card();
    let cardToAttackWith = new Card();
    let cardToAttack = new Card();
    let cardToUse = new Card();
    let cardToTarget = new Card();
    switch (action.type) {
      case ACTION_TYPES.SUMMON:
        cardToSummon = this.cards.find((card) => action.sourceInstanceId === card.instanceId);
        if (debug) {
          if (cardToSummon.instanceId === -1) {
            printErr('Attempted to summon a card with an invalid instanceId.');
          }
          if (cardToSummon.type !== CARD_TYPES.CREATURE) {
            printErr('Attempted to summon a card of a non-CREATURE type.');
          }
          if (cardToSummon.cost > (isPlayerTurn ? this.player.mana : this.opponent.mana)) {
            printErr('Attempted to summon a CREATURE with mana cost greater than the participant\'s max mana.');
          }
          if ((isPlayerTurn && cardToSummon.location !== CARD_LOCATIONS.PLAYER_HAND)) {
            printErr('Attempted to summon a CREATURE that isn\'t inside the player\'s hand.');
          }
          if ((isPlayerTurn ? playerBoard.length > MAX_CARDS_ON_BOARD : opponentBoard.length > MAX_CARDS_ON_BOARD)) {
            printErr('Attempted to summon a CREATURE when the participant\'s board is full.');
          }
        }

        cardToSummon.location = isPlayerTurn ? CARD_LOCATIONS.PLAYER_BOARD : CARD_LOCATIONS.OPPONENT_BOARD;
        if (isPlayerTurn) {
          this.player.mana -= cardToSummon.cost;
          this.player.cardDraw += cardToSummon.draw;
        } else {
          this.opponent.mana -= cardToSummon.cost;
          this.opponent.cardDraw += cardToSummon.draw;
        }

        cardToSummon.canAttack = cardToSummon.charge;
        this.player.health += cardToSummon.playerHealthChange;
        this.opponent.health += cardToSummon.opponentHealthChange;
        break;
      case ACTION_TYPES.ATTACK:
        cardToAttackWith = this.cards.find((card) => action.sourceInstanceId === card.instanceId);
        if (action.targetInstanceId !== -1) {
          cardToAttack = this.cards.find((card) => action.targetInstanceId === card.instanceId);
        }

        if (debug) {
          if (cardToAttackWith.type !== CARD_TYPES.CREATURE) {
            printErr('Attempted to attack with a non-CREATURE card.');
          }
          if (cardToAttack.instanceId !== -1 && cardToAttack.type !== CARD_TYPES.CREATURE) {
            printErr('Attempted to attack a non-CREATURE card.');
          }
          if (!cardToAttackWith.canAttack) {
            printErr('Attempted to attack with a card that can\'t attack.');
          }
          if (cardToAttack.instanceId !== -1 && (isPlayerTurn ? !opponentBoard.map((card) => card.instanceId).includes(cardToAttack.instanceId) : !playerBoard.map((card) => card.instanceId).includes(cardToAttack.instanceId))) {
            printErr('Attempted to attack a card that isn\'t on the other participant\'s board.');
          }
          if (cardToAttackWith.defense <= 0) {
            printErr('Attempted to attack with a defense 0 CREATURE.');
          }
          if (cardToAttack.instanceId !== -1 && cardToAttack.defense <= 0) {
            printErr('Attempted to attack a defense 0 CREATURE.');
          }
          const playerGuardCreatures = playerBoard.filter((card) => card.guard);
          const opponentGuardCreatures = opponentBoard.filter((card) => card.guard);
          if ((isPlayerTurn ? (cardToAttack.instanceId === -1 || !cardToAttack.guard) && opponentGuardCreatures.length > 0 : (cardToAttack.instanceId === -1 || !cardToAttack.guard) && playerGuardCreatures.length > 0)) {
            printErr('Attempted to attack a non-GUARD CREATURE when the other participant has a GUARD CREATURE.');
          }
        }

        if (cardToAttack.instanceId === -1) {
          this.opponent.health -= cardToAttackWith.attack;

          if (cardToAttackWith.drain) {
            this.player.health += cardToAttackWith.attack;
          }
          // TODO: Consider runes.
        } else {
          if (cardToAttackWith.breakthrough) {
            if (!cardToAttack.ward) {
              const remainder = cardToAttackWith.attack - cardToAttack.defense;
              if (remainder > 0) {
                this.opponent.health -= remainder;
              }
            }
          }

          if (cardToAttackWith.drain) {
            if (!cardToAttack.ward) {
              this.player.health += cardToAttackWith.attack;
            }
          }

          if (cardToAttack.ward) {
            if (cardToAttackWith.attack > 0) {
              cardToAttack.ward = false;
            }
            if (cardToAttackWith.ward) {
              if (cardToAttack.attack > 0) {
                cardToAttackWith.ward = false;
              }
            } else {
              if (cardToAttack.lethal) {
                if (cardToAttack.attack > 0) {
                  cardToAttackWith.defense = 0;
                }
              } else {
                cardToAttackWith.defense -= cardToAttack.attack;
              }
            }
          } else {
            if (cardToAttackWith.ward) {
              if (cardToAttack.attack > 0) {
                cardToAttackWith.ward = false;
              }
              if (cardToAttackWith.lethal) {
                if (cardToAttackWith.attack > 0) {
                  cardToAttack.defense = 0;
                }
              } else {
                cardToAttack.defense -= cardToAttackWith.attack;
              }
            } else {
              if (cardToAttackWith.lethal) {
                if (cardToAttack.lethal) {
                  if (cardToAttackWith.attack > 0) {
                    cardToAttack.defense = 0;
                  }
                  if (cardToAttack.attack > 0) {
                    cardToAttackWith.defense = 0;
                  }
                } else {
                  if (cardToAttackWith.attack > 0) {
                    cardToAttack.defense = 0;
                  }
                  cardToAttackWith.defense -= cardToAttack.attack;
                }
              } else {
                if (cardToAttack.lethal) {
                  if (cardToAttack.attack > 0) {
                    cardToAttackWith.defense = 0;
                  }
                  cardToAttack.defense -= cardToAttackWith.attack;
                } else {
                  cardToAttackWith.defense -= cardToAttack.attack;
                  cardToAttack.defense -= cardToAttackWith.attack;
                }
              }
            }
          }

          if (cardToAttackWith.defense <= 0) {
            cardToAttackWith.location = CARD_LOCATIONS.OUT_OF_PLAY;
          }
          if (cardToAttack.defense <= 0) {
            cardToAttack.location = CARD_LOCATIONS.OUT_OF_PLAY;
          }
        }
        cardToAttackWith.canAttack = false;
        break;
      case ACTION_TYPES.USE:
        cardToUse = this.cards.find((card) => action.sourceInstanceId === card.instanceId);
        if (action.targetInstanceId !== -1) {
          cardToTarget = this.cards.find((card) => action.targetInstanceId === card.instanceId);
        }

        if (debug) {
          if (cardToUse.instanceId === -1) {
            printErr('Attempted to use a card with an invalid instanceId.');
          }
          if (cardToUse.type === CARD_TYPES.GREEN_ITEM && (isPlayerTurn ? playerBoard.length > MAX_CARDS_ON_BOARD : opponentBoard.length > MAX_CARDS_ON_BOARD)) {
            printErr('Attempted to use a GREEN_ITEM when the participant\'s board is empty.');
          }
          if (cardToUse.type === CARD_TYPES.CREATURE) {
            printErr('Attempted to use a card of a non-ITEM type.');
          }
          if (cardToUse.cost > (isPlayerTurn ? this.player.mana : this.opponent.mana)) {
            printErr('Attempted to use an ITEM with mana cost greater than the participant\'s max mana.');
          }
          if ((isPlayerTurn && cardToUse.location !== CARD_LOCATIONS.PLAYER_HAND)) {
            printErr('Attempted to use an ITEM that isn\'t inside the player\'s hand.');
          }
          if (cardToUse.type === CARD_TYPES.GREEN_ITEM && (isPlayerTurn ? !playerBoard.map((card) => card.instanceId).includes(cardToTarget.instanceId) : !opponentBoard.map((card) => card.instanceId).includes(cardToTarget.instanceId))) {
            printErr('Attempted to use a GREEN_ITEM on an invalid target.');
          }
          if (cardToTarget.instanceId !== -1 && cardToUse.type !== CARD_TYPES.GREEN_ITEM && cardToUse.type !== CARD_TYPES.CREATURE && (isPlayerTurn ? !opponentBoard.map((card) => card.instanceId).includes(cardToTarget.instanceId) : !playerBoard.map((card) => card.instanceId).includes(cardToTarget.instanceId))) {
            printErr('Attempted to use a RED_ITEM or a BLUE_ITEM on an invalid target.');
          }
          if (cardToTarget.instanceId !== -1 && cardToTarget.defense <= 0) {
            printErr('Attempted to use an ITEM on a defense 0 target.');
          }
          if (cardToTarget.instanceId !== -1 && cardToTarget.type !== CARD_TYPES.CREATURE) {
            printErr('Attempted to use an ITEM on an ITEM target.');
          }
        }

        if (cardToTarget !== -1) {
          if (cardToUse.type === CARD_TYPES.GREEN_ITEM) {
            cardToTarget.breakthrough = cardToTarget.breakthrough || cardToUse.breakthrough;
            cardToTarget.charge = cardToTarget.charge || cardToUse.charge;
            cardToTarget.drain = cardToTarget.drain || cardToUse.drain;
            cardToTarget.guard = cardToTarget.guard || cardToUse.guard;
            cardToTarget.lethal = cardToTarget.lethal || cardToUse.lethal;
            cardToTarget.ward = cardToTarget.ward || cardToUse.ward;
          } else if (cardToUse.type === CARD_TYPES.RED_ITEM) {
            cardToTarget.breakthrough = !cardToUse.breakthrough && cardToTarget.breakthrough;
            cardToTarget.charge = !cardToUse.charge && cardToTarget.charge;
            cardToTarget.drain = !cardToUse.drain && cardToTarget.drain;
            cardToTarget.guard = !cardToUse.guard && cardToTarget.guard;
            cardToTarget.lethal = !cardToUse.lethal && cardToTarget.lethal;
            cardToTarget.ward = !cardToUse.ward && cardToTarget.ward;
          }
          if (cardToTarget.ward && cardToUse.defense < 0) {
            cardToTarget.ward = false;
          } else {
            cardToTarget.defense += cardToUse.defense;
          }
          cardToTarget.attack += cardToUse.attack;
          if (cardToTarget.attack < 0) {
            cardToTarget.attack = 0;
          }
        }

        if (cardToTarget.defense <= 0) {
          cardToTarget.location = CARD_LOCATIONS.OUT_OF_PLAY;
        }
        cardToUse.location = CARD_LOCATIONS.OUT_OF_PLAY;

        if (isPlayerTurn) {
          this.player.mana -= cardToUse.cost;
          this.player.cardDraw += cardToUse.draw;
        } else {
          this.opponent.mana -= cardToUse.cost;
          this.opponent.cardDraw += cardToUse.draw;
        }

        this.player.health += cardToUse.playerHealthChange;
        this.opponent.health += cardToUse.opponentHealthChange;
        // TODO: Consider runes.
        break;
      case ACTION_TYPES.PICK:
        printErr('Attempted to execute an action of type PICK.');
        break;
      default: // ACTION_TYPES.PASS
        printErr('Attempted to execute an action of type PASS.');
        break;
    }
  }

  updateTurn(turn, isPlayerTurn, debug) {
    for (let action of turn.actions) {
      this.updateAction(action, isPlayerTurn, debug);
    }
  }

  generateActions(isPlayerTurn) {
    const opponentBoard = this.cards.filter((card) => card.location === CARD_LOCATIONS.OPPONENT_BOARD);
    const playerBoard = this.cards.filter((card) => card.location === CARD_LOCATIONS.PLAYER_BOARD);
    const playerHand = this.cards.filter((card) => card.location === CARD_LOCATIONS.PLAYER_HAND);

    if (isPlayerTurn) {
      for (let cardInPlayerHand of playerHand) {
        if (cardInPlayerHand.cost <= this.player.mana) {
          let action;
          switch (cardInPlayerHand.type) {
            case CARD_TYPES.CREATURE:
              if (playerBoard.length < MAX_CARDS_ON_BOARD) {
                action = new Action();
                action.summon(cardInPlayerHand.instanceId);
                this.actions.push(action);
              }
              break;
            case CARD_TYPES.GREEN_ITEM:
              for (let cardOnPlayersSideOfTheBoard of playerBoard) {
                action = new Action();
                action.use(cardInPlayerHand.instanceId, cardOnPlayersSideOfTheBoard.instanceId);
                this.actions.push(action);
              }
              break;
            case CARD_TYPES.RED_ITEM:
              for (let cardOnOpponentsSideOfTheBoard of opponentBoard) {
                action = new Action();
                action.use(cardInPlayerHand.instanceId, cardOnOpponentsSideOfTheBoard.instanceId);
                this.actions.push(action);
              }
              break;
            case CARD_TYPES.BLUE_ITEM:
              action = new Action();
              action.use(cardInPlayerHand.instanceId);
              this.actions.push(action);

              if (cardInPlayerHand.defense < 0) {
                for (let cardOnOpponentsSideOfTheBoard of opponentBoard) {
                  const action1 = new Action();
                  action1.use(cardInPlayerHand.instanceId, cardOnOpponentsSideOfTheBoard.instanceId);
                  this.actions.push(action1);
                }
              }
              break;
          }
        }
      }
    }

    const participantOnTurnBoard = isPlayerTurn ? playerBoard : opponentBoard;
    const participantNotOnTurnBoard = isPlayerTurn ? opponentBoard : playerBoard;
    const participantNotOnTurnBoardGuards = participantNotOnTurnBoard.filter((card) => card.guard);
    for (let participantOnTurnCardOnBoard of participantOnTurnBoard) {
      if (participantOnTurnCardOnBoard.canAttack) {
        if (participantNotOnTurnBoardGuards.length === 0) {
          const action = new Action();
          action.attack(participantOnTurnCardOnBoard.instanceId);
          this.actions.push(action);

          for (let card of participantNotOnTurnBoard) {
            const action1 = new Action();
            action1.attack(participantOnTurnCardOnBoard.instanceId, card.instanceId);
            this.actions.push(action1);
          }
        } else {
          for (let card of participantNotOnTurnBoardGuards) {
            const action = new Action();
            action.attack(participantOnTurnCardOnBoard.instanceId, card.instanceId);
            this.actions.push(action);
          }
        }
      }
    }
  }

  getRandomAction(isPlayerTurn) {
    this.actions = [];
    this.generateActions(isPlayerTurn);
    if (this.actions.length > 0) {
      this.randomAction = this.actions[Math.floor(Math.random() * this.actions.length)];

      return true;
    } else {
      return false;
    }
  }
}

class Turn {
  constructor(actions) {
    this.actions = actions || [];
  }

  newAction() {
    const action = new Action();
    this.actions.push(action);

    return action;
  }

  isCardPlayed(instanceId) {
    for (let action of this.actions) {
      if ((action.type === ACTION_TYPES.SUMMON || action.type === ACTION_TYPES.USE) && action.sourceInstanceId === instanceId) {
        return true;
      }
    }

    return false;
  }

  write(outputArray) {
    if (this.actions.length === 0) {
      outputArray.push('PASS');

      return;
    }

    for (let action of this.actions) {
      action.write(outputArray);
    }
  }
}

class Timeout {
  constructor(startMs) {
    this.startMs = startMs || 0;
  }

  start() {
    this.startMs = +new Date();
  }

  isElapsed(limit) {
    return +new Date() - this.startMs >= limit;
  }

  timeSpentThinking() {
    return +new Date() - this.startMs;
  }
}

class Agent {
  constructor(state, bestTurn, draftedCards, manaCurve, cardScores, timeout) {
    this.state = state || new State();
    this.bestTurn = bestTurn || new Turn();
    this.draftedCards = draftedCards || [];
    this.manaCurve = manaCurve || {
      '0-1': 0,
      '2': 4,
      '3': 4,
      '4': 4,
      '5': 3,
      '6': 3,
      '7+': 6,
    };
    this.cardScores = cardScores || {
      '83': 62,
      '91': 60,
      '118': 62,
      '136': 56,
      '142': 48,
      '143': 14,
      '141': 17,
      '48': 74,
      '3': 73,
      '93': 72,
      '39': 71,
      '1': 70,
      '38': 65,
      '2': 62,
      '24': 60,
      '92': 57,
      '119': 60,
      '144': 50,
      '117': 18,
      '49': 74,
      '65': 73,
      '7': 73,
      '95': 70,
      '96': 69,
      '26': 68,
      '8': 67,
      '6': 66,
      '29': 65,
      '47': 65,
      '4': 65,
      '94': 62,
      '5': 61,
      '27': 60,
      '28': 59,
      '84': 58,
      '25': 57,
      '64': 55,
      '63': 52,
      '55': 50,
      '121': 65,
      '150': 62,
      '122': 61,
      '137': 61,
      '120': 58,
      '148': 55,
      '123': 48,
      '138': 48,
      '147': 48,
      '140': 20,
      '154': 16,
      '153': 11,
      '160': 12,
      '69': 74,
      '9': 73,
      '99': 70,
      '50': 65,
      '54': 64,
      '12': 63,
      '98': 63,
      '85': 63,
      '97': 63,
      '32': 63,
      '40': 62,
      '100': 62,
      '11': 62,
      '41': 61,
      '30': 60,
      '86': 59,
      '10': 55,
      '31': 52,
      '158': 59,
      '125': 59,
      '155': 58,
      '127': 58,
      '126': 57,
      '157': 47,
      '149': 15,
      '145': 21,
      '124': 22,
      '156': 13,
      '73': 74,
      '51': 73,
      '103': 72,
      '18': 71,
      '15': 70,
      '17': 70,
      '53': 69,
      '70': 68,
      '104': 65,
      '87': 65,
      '33': 65,
      '56': 64,
      '72': 60,
      '13': 59,
      '52': 58,
      '16': 58,
      '71': 57,
      '57': 55,
      '101': 54,
      '14': 53,
      '42': 51,
      '102': 50,
      '139': 63,
      '129': 62,
      '128': 61,
      '130': 57,
      '159': 55,
      '134': 48,
      '146': 19,
      '131': 24,
      '75': 74,
      '105': 73,
      '19': 70,
      '109': 70,
      '106': 69,
      '74': 68,
      '21': 67,
      '88': 66,
      '34': 65,
      '66': 60,
      '20': 50,
      '89': 48,
      '107': 31,
      '108': 30,
      '110': 27,
      '151': 58,
      '132': 23,
      '133': 25,
      '68': 74,
      '45': 73,
      '111': 66,
      '76': 65,
      '44': 65,
      '112': 65,
      '37': 65,
      '67': 64,
      '43': 63,
      '58': 62,
      '22': 61,
      '36': 60,
      '35': 28,
      '113': 26,
      '135': 57,
      '114': 66,
      '82': 66,
      '77': 65,
      '23': 65,
      '59': 62,
      '60': 29,
      '152': 10,
      '80': 70,
      '79': 64,
      '90': 50,
      '115': 49,
      '78': 48,
      '46': 54,
      '61': 54,
      '81': 54,
      '116': 71,
      '62': 66,
    };
    this.timeout = timeout || new Timeout();
  }

  static evalScore(newState) {
    if (newState.opponent.health <= 0) {
      return 9999;
    }
    if (newState.player.health <= 0) {
      return -9999;
    }
    const opponentBoard = newState.cards.filter((card) => card.location === CARD_LOCATIONS.OPPONENT_BOARD);
    const playerBoard = newState.cards.filter((card) => card.location === CARD_LOCATIONS.PLAYER_BOARD);
    const playerHand = newState.cards.filter((card) => card.location === CARD_LOCATIONS.PLAYER_HAND);
    const playerHealth = newState.player.health;
    const opponentHealth = newState.opponent.health;

    let playerBoardScore = 0;
    playerBoard.forEach((c) => {
      playerBoardScore += c.attack * PLAYER_CREATURE_ATTACK_WEIGHT;
      playerBoardScore += c.defense * PLAYER_CREATURE_DEFENSE_WEIGHT;
      if (c.guard) {
        playerBoardScore += ((c.attack + c.defense * 3) / 8) * GUARD_WEIGHT + 1 / playerHealth;
      }
      if (c.lethal) {
        playerBoardScore += LETHAL_WEIGHT;
      }
      if (c.ward) {
        playerBoardScore += WARD_WEIGHT;
      }
    });
    let opponentBoardScore = 0;
    opponentBoard.forEach((c) => {
      opponentBoardScore -= c.attack * OPPONENT_CREATURE_ATTACK_WEIGHT;
      opponentBoardScore -= c.defense * OPPONENT_CREATURE_DEFENSE_WEIGHT;
      if (c.guard) {
        opponentBoardScore -= ((c.attack + c.defense * 3) / 8) * GUARD_WEIGHT + 1 / opponentHealth;
      }
      if (c.lethal) {
        opponentBoardScore -= LETHAL_WEIGHT;
      }
      if (c.ward) {
        opponentBoardScore -= WARD_WEIGHT;
      }
    });
    let playerHandScore = 0;
    playerHand.forEach((c) => {
      playerHandScore += c.cost;
    });
    playerHandScore *= PLAYER_HAND_MANA_COST_WEIGHT;
    const playerHealthScore = playerHealth * PLAYER_HEALTH_WEIGHT;
    const opponentHealthScore = -opponentHealth * OPPONENT_HEALTH_WEIGHT;

    let potentialGameEndScoreMultiplier = 1;
    if (opponentHealth <= 0) {
      potentialGameEndScoreMultiplier = PLAYER_WINS_WEIGHT;
    } else if (playerHealth <= 0) {
      potentialGameEndScoreMultiplier = OPPONENT_WINS_WEIGHT;
    }

    return (playerBoardScore + opponentBoardScore + playerHandScore + playerHealthScore + opponentHealthScore) * potentialGameEndScoreMultiplier;
  }

  read() {
    this.state = new State();
    this.state.read();

    this.timeout.start();
  }

  think() {
    this.bestTurn = new Turn();

    // Draft phase.
    if (this.state.isInDraft()) {
      let bestCard;
      let bestFitness = -1;
      let bestIndex;
      const msg = [];
      this.state.cards.forEach((card, index) => {
        const manaCurveMultiplier = card.shouldCardScoreBeMultiplied(this.manaCurve) ? this.getCardScoreMultiplierBasedOnDraftedCardsCount() : card.type !== CARD_TYPES.CREATURE ? 1.2 : 1;
        const cardFitness = this.cardScores[card.number] * manaCurveMultiplier;
        msg.push(cardFitness.toFixed(2));
        if (cardFitness > bestFitness || (cardFitness === bestFitness && card.cost < bestCard.cost)) { // If equal pick the cheaper one.
          bestCard = card;
          bestFitness = cardFitness;
          bestIndex = index;
        }
      });
      this.updateManaCurve(bestCard);
      this.draftedCards.push(bestCard);

      this.bestTurn = new Turn();
      const action = this.bestTurn.newAction();
      action.pick(bestIndex, msg);

      return;
    }

    let bestScore = Number.MIN_SAFE_INTEGER;
    let currentBestTurn = new Turn();

    let turnsCount = 0;

    // Battle phase.
    while ((turnsCount % 127) > 0 || !this.timeout.isElapsed(TIME_TO_THINK_IN_MS)) {
      const newState = this.state.deepClone();
      const turn = new Turn();

      while (true) {
        if (!newState.getRandomAction(true)) {
          break;
        }
        turn.actions.push(newState.randomAction);
        newState.updateAction(newState.randomAction, true, false);
      }
      const score = Agent.evalScore(newState);
      if (score > bestScore) {
        bestScore = score;
        currentBestTurn = turn;
      }
      turnsCount++;
    }
    printErr(`Time spent thinking: ${this.timeout.timeSpentThinking()}; Turns count: ${turnsCount}; Best score: ${bestScore.toFixed(2)};`);
    this.bestTurn = currentBestTurn;
  }

  write() {
    const output = [];
    this.bestTurn.write(output);
    print(output.join(' '));
  }

  getCardScoreMultiplierBasedOnDraftedCardsCount() {
    const draftedCardsCount = this.draftedCards.length;
    if (draftedCardsCount < 10) {
      return 1.15;
    } else if (draftedCardsCount < 20) {
      return 1.20;
    } else if (draftedCardsCount < 25) {
      return 1.25;
    } else if (draftedCardsCount < 30) {
      return 1.30;
    }
  }

  updateManaCurve(card) {
    if (card.type !== CARD_TYPES.CREATURE) {
      return;
    }
    switch (card.cost) {
      case 0:
      case 1:
        this.manaCurve['0-1']--;
        break;
      case 2:
        this.manaCurve['2']--;
        break;
      case 3:
        this.manaCurve['3']--;
        break;
      case 4:
        this.manaCurve['4']--;
        break;
      case 5:
        this.manaCurve['5']--;
        break;
      case 6:
        this.manaCurve['6']--;
        break;
      default: // 7+
        this.manaCurve['7+']--;
        break;
    }
  }
}

const agent = new Agent();

while (true) {
  agent.read();
  agent.think();
  agent.write();
}
