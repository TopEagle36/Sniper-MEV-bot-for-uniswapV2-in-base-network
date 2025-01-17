import * as dotenv from 'dotenv';
import { Web3, WebSocketProvider } from 'web3';

// Use Redis for low latency
import Redis from "ioredis";
import { UNISWAP_ROUTER_ADDRESS, WETH_ADDRESS, UNISWAP_FACTORY_ADDRESS, TOKEN_ABI, UNISWAP_FACTORY_ABI, UNISWAP_ROUTER_ABI, USDC_ADDRESS } from './const.js';

dotenv.config();

const redis = new Redis();
const saveTokenInfo = async (tokenAddress)=> {
  try {
    const epochInSeconds= Math.floor(Date.now() / 1000);
    await redis.set(`token: ${tokenAddress}`, JSON.stringify({ctime: epochInSeconds, first: 1}));
    return true;
  }catch(saveErr){
    console.log("Redis Save error");
    return false
  }
}

const delTokenInfo = async (tokenAddress) => {
  try {
    await redis.del(`token: ${tokenAddress}`);
    console.log(`Token ${tokenAddress} sold and removed from Redis.`);
    return true;
  }catch (delErr) {
    console.log("delete err", delErr);
    return false;
  }
}

const updateTokenInfo = async(tokenAddress, tokenInfo)=>{
  try {
    await redis.set(`token:${tokenAddress}`, JSON.stringify({ ...tokenInfo, first: 0 }));
    return true;
  }catch (upErr) {
    console.log("update err", upErr);
    return false;
  }
}




// ============web3 init part==============
const web3 = new Web3(new Web3.providers.WebsocketProvider(process.env.RPC_URL));


const privateToaddr = web3.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY);
const router = new web3.eth.Contract(UNISWAP_ROUTER_ABI, UNISWAP_ROUTER_ADDRESS);
const factory = new web3.eth.Contract(UNISWAP_FACTORY_ABI, UNISWAP_FACTORY_ADDRESS);

let getETHBalance = async (publicKey) => {
  let ethBal = await web3.eth.getBalance(publicKey);
  let val = Number(ethBal) / Math.pow(10, 18);
  console.log(`=====Your Ethereum balance is ${val} eth=====`);
  return ethBal;
}

const EthVal = await getETHBalance(privateToaddr.address);

const targetEthAmount = '0.001'; // 0.001 eth
const ethAmountInWei = web3.utils.toWei(targetEthAmount, 'ether');
const aproveMax = '10000000000';
const gasPrice = 70000000; // 0.07Gwei
const gasLimit = 1000000;
const eightySellprofit = 15;
const twentySellprofit = 100;
const sellAlltime = 60; // 1hour
const buySlippage = 5;
const sellSlippage = 15;

let transactionStatus = false;
// let swapEthGasPrice = BigInt('10000000000'); // 40gwei, Default gasPrice to buy target token
// let swapTokenGasPrice = BigInt('10000000000'); // 10gwei Default gasPrice to sell target token

// ==============Helper functions===============
let swapExactETHForTokensSupportingFeeOnTransferTokens = async (txData) => {
  const { tokenAddress, baseToken, value, gasPrice } = txData;

  // pre approve to optimize speed on sell and to check if it is sellable later
  const tokenInfo = await getTokenInfo(tokenAddress);

  const approveStatus = await approveToken(tokenInfo);
  if(approveStatus){
    const tokenAmountOut = await getTokenOut(tokenAddress);
    console.log("tokenAmountout", tokenAmountOut);
    const slippagedAmount = Math.floor(Number(tokenAmountOut)-Number(tokenAmountOut)*buySlippage/100);
    console.log("splippaged amout", slippagedAmount);
    const swapExactETHForTokensTx = router.methods.swapExactETHForTokensSupportingFeeOnTransferTokens(
      BigInt(slippagedAmount),
      [baseToken, tokenAddress],
      privateToaddr.address,
      Date.now() + 1000 * 60 * 1
    );
    const tx = {
      to: UNISWAP_ROUTER_ADDRESS,
      data: swapExactETHForTokensTx.encodeABI(),
      gasPrice: web3.utils.toHex(gasPrice),
      gasLimit: web3.utils.toHex(gasLimit),
      value: value, //should be BigInt type
      // value: web3.utils.toWei(1, 'ether'), //BigInt type
      nonce: web3.utils.toHex(await web3.eth.getTransactionCount(privateToaddr.address)),
    }
    const createTransaction = await web3.eth.accounts.signTransaction(
      tx,
      privateToaddr.privateKey
    );
    // 8. Send transaction and wait for receipt
    try {
      const createReceipt = await web3.eth.sendSignedTransaction(
        createTransaction.rawTransaction
      );
      console.log(`Tx successful with hash: ${createReceipt.transactionHash}`);
      return true;
  
    }

    catch (err) {
      console.log("err", err);
      return false;
    }
  }else{
    console.log("approve failed, can't sell tokens later!");
    return false;
  }

}

let getTokenInfo = async (tokenAddr) => {
  const token_contract = new web3.eth.Contract(TOKEN_ABI, tokenAddr);
  const balance = await token_contract.methods
    .balanceOf(privateToaddr.address)
    .call();
  // var totalSupply = await token_contract.methods.totalSupply().call();
  // var decimals = await token_contract.methods.decimals().call();
  // var symbol = await token_contract.methods.symbol().call();

  return {
    address: tokenAddr,
    balance: balance,
    token_contract: token_contract
  };
}

let approveToken = async (tokenInfo) => {
  try{
    // let allowance = await tokenInfo.token_contract.methods
    //   .allowance(privateToaddr.address, UNISWAP_ROUTER_ADDRESS)
    //   .call();
    // if (tokenInfo.balance > allowance) {
      const approveTx = tokenInfo.token_contract.methods.approve(
        UNISWAP_ROUTER_ADDRESS, web3.utils.toWei(aproveMax, 'ether')
      );
      const tx = {
        from: privateToaddr.address,
        to: tokenInfo.address,
        data: approveTx.encodeABI(),
        gasPrice: web3.utils.toHex(gasPrice),
        // gasLimit: web3.utils.toHex(900000),
        // value: web3.utils.toHex(web3.utils.fromWei(value,'ether')),
        nonce: web3.utils.toHex(await web3.eth.getTransactionCount(privateToaddr.address))
      }
      const createTransaction = await web3.eth.accounts.signTransaction(
        tx,
        privateToaddr.privateKey
      );
      // 8. Send transaction and wait for receipt
      const createReceipt = await web3.eth.sendSignedTransaction(
        createTransaction.rawTransaction
      );
      console.log(`Tx successful with hash: ${createReceipt.transactionHash}`);
    // }
    // else {
    //   console.log("already approved");
    // }
    return true;
  }catch (approveErr){
    console.log("approve err", approveErr);
    return false;
  }

}

let swapExactTokensForETHSupportingFeeOnTransferTokens = async (txData) => {
  const { tokenAddress, baseToken, gasPrice, sellPercent = 100 } = txData;
  const tokenInfo = await getTokenInfo(tokenAddress);
  if(!tokenInfo.balance){
    console.log("token balance is 0");
    return false;
  }
  const sellAmount = BigInt(Math.floor(Number(tokenInfo.balance) * sellPercent/ 100)) ;
  const ethOut = getEthOut(tokenAddress, sellAmount);
  const slippagedAmount = Math.floor(Number(ethOut)- Number(ethOut)* sellSlippage/100);
  // await approveToken(tokenInfo);
  const swapExactTokensForETHSupportingFeeOnTransferTokensExactTokensForEHTx = router.methods.swapExactTokensForETHSupportingFeeOnTransferTokens(
    sellAmount,
    slippagedAmount,
    [tokenAddress, baseToken],
    privateToaddr.address,
    Date.now() + 1000 * 60 * 4
  );
  const tx = {
    from: privateToaddr.address,
    to: UNISWAP_ROUTER_ADDRESS,
    data: swapExactTokensForETHSupportingFeeOnTransferTokensExactTokensForEHTx.encodeABI(),
    gasPrice: web3.utils.toHex(gasPrice),
    gasLimit: web3.utils.toHex(gasLimit),
    // value: web3.utils.toHex(web3.utils.fromWei(value,'ether')),
    nonce: web3.utils.toHex(await web3.eth.getTransactionCount(privateToaddr.address)),
  };
  const createTransaction = await web3.eth.accounts.signTransaction(
    tx,
    privateToaddr.privateKey
  );
  // 8. Send transaction and wait for receipt
  try {
    const createReceipt = await web3.eth.sendSignedTransaction(
      createTransaction.rawTransaction
    );
    console.log(`Tx successful with hash: ${createReceipt.transactionHash}`);
    return true;
  }catch(sellErr){
    console.log("sellErr", sellErr);
    return false;
  }

}

console.log("Listening paircreated event from uniswapV2 on BASE")

const getTokenOut = async (newToken) => {
  const path = [WETH_ADDRESS, newToken];
  try {
    const inputAmount = ethAmountInWei;
    const amountTokenOut= await router.methods.getAmountsOut(inputAmount, path).call();
    
    return amountTokenOut[1];
  } catch(error) {
    console.log(`No liquidity yet for ${newToken} or an error occurred.`);
    return false;
  }
}
const getEthOut = async(tokenAddress, amount) =>{
  try {
    const path = [tokenAddress, WETH_ADDRESS];
    const amountEthOut = await router.methods.getAmountsOut(amount, path).call();
    return amountEthOut[1];
  }catch(ethOutErr){
    console.log("eth out err", ethOutErr);
    return false;
  }
  
}



factory.events.PairCreated({ fromBlock: 'latest' })
  .on('data', async (event) => {
    try {
      const { token0, token1, pair } = event.returnValues;
      console.log(`New Pair Created: ${token0}, ${token1} at ${pair}`);
      const newToken = token0.toLowerCase() === WETH_ADDRESS.toLowerCase() ||
                       token0.toLowerCase() === USDC_ADDRESS.toLowerCase()
                       ? token1 : token0;

      if (token0.toLowerCase() === WETH_ADDRESS.toLowerCase() ||
          token1.toLowerCase() === WETH_ADDRESS.toLowerCase() ||
          token0.toLowerCase() === USDC_ADDRESS.toLowerCase() ||
          token1.toLowerCase() === USDC_ADDRESS.toLowerCase()) {
        console.log(`New Token Detected: ${newToken}`);
        const amountTokenOut = await getTokenOut(newToken);
        if(amountTokenOut){
          // Buy token
          if(!transactionStatus){
            transactionStatus = true;
            const buyStatus = await swapExactETHForTokensSupportingFeeOnTransferTokens({tokenAddress: newToken, baseToken: WETH_ADDRESS, value: ethAmountInWei, gasPrice: gasPrice});
            transactionStatus = false;
            if(buyStatus){
              // Save to Redis 
              const saveStatus = await saveTokenInfo(newToken);
              // if couldn't save then sell imediately
              if(!saveStatus){
                console.log("Sellinig tokens immediately as can't save to Redis")
                // Sell token
                const sellStatus = await swapExactTokensForETHSupportingFeeOnTransferTokens({ tokenAddress: newToken, baseToken: WETH_ADDRESS, gasPrice: gasPrice });
                if(!sellStatus){
                  console.error("===============Didn't sell token please try to sell manually=================");
                }
              }
            }
          } else {
            console.log("new token detected! but currently another tx is still in progress, so ignore")
          }
        }
      }
    } catch (e) {
      console.error("Error processing event:", e);
    }
  });

// cron job that fetch token price every 1 sec;
setInterval(async () => {
  const tokens = await redis.keys("token:*");
  for (const tokenKey of tokens) {
    const tokenInfo = JSON.parse(await redis.get(tokenKey));
    const tokenKeyAddress = tokenKey.split(': ')[1];
    console.log("tokenKeyAddres", tokenKeyAddress);
    // firstly let's see if 60mins passed
    const epochInSecondsNow= Math.floor(Date.now() / 1000);
    const timePassed = epochInSecondsNow - tokenInfo.ctime;
    if(timePassed >= 60*sellAlltime){
      // if passed sell token
      if(!transactionStatus){
        transactionStatus = true;
        const sellStatus = await swapExactTokensForETHSupportingFeeOnTransferTokens({ tokenAddress: tokenKeyAddress, baseToken: WETH_ADDRESS, gasPrice: gasPrice });
        transactionStatus = false;
        if(sellStatus){
          // if selled correctly remove in redis
          await delTokenInfo(tokenKey);
        }else {
          console.error(`======================Couldn't sell token ${tokenKeyAddress}. I will try to sell but if error consist then Please sell manually=======================`);
        }
      }else {
        console.log("Let's wait other tx finished")
      }
      
    }else {
      const tokenInfo = await getTokenInfo(tokenKeyAddress);
      const newPrice = await getEthOut(tokenKeyAddress, tokenInfo.balance); // Fetch latest price
      console.log("newPrice", newPrice);
      const profit = (Number(newPrice) - Number(ethAmountInWei))*100/Number(ethAmountInWei);
      if(profit >= twentySellprofit){
        if( tokenInfo.first == 0){
          // sell the rest 20% tokens
          if(!transactionStatus){
            transactionStatus = true;
            const sellStatus = await swapExactTokensForETHSupportingFeeOnTransferTokens({ tokenAddress: tokenKeyAddress, baseToken: WETH_ADDRESS, gasPrice: gasPrice });
            transactionStatus = false;
            if(sellStatus){
              // if selled correctly remove in redis
              await delTokenInfo(tokenKey);
            }else {
              console.error(`======================Couldn't sell token ${tokenKeyAddress}. I will try to sell but if error consist then Please sell manually=======================`);
            }
          }else {
            console.log("Other tx in the way, let's wait sometime");
          }
        }else {
          // sell only 80% tokens
          if(profit >= eightySellprofit){
            if(!transactionStatus){
              transactionStatus = true;
              console.log(`Selling 80% tokens ${tokenKeyAddress} for ${eightySellprofit}% profit`);
              const sellStatus = await swapExactTokensForETHSupportingFeeOnTransferTokens({ tokenAddress: tokenKeyAddress, baseToken: WETH_ADDRESS, gasPrice: gasPrice, sellPercent: 80 });
              transactionStatus = false
              if(sellStatus){
                //update redis to first = 0
                updateTokenInfo(tokenKey, tokenInfo);
              }else {
                console.error(`======================Couldn't sell token ${tokenKeyAddress}. I will try to sell but if error consist then Please sell manually=======================`);
              }
            }else {
              console.log("Other tx in the way, let's wait sometime");
            }
            
          }
        }
      }else {
        if( tokenInfo.first == 0){
          // this means 80% already sold;
          console.log("80% already sold");
        }else {
          if(profit >= eightySellprofit){
            if(!transactionStatus){
              transactionStatus = true;
              console.log(`Selling 80% tokens ${tokenKeyAddress} for ${eightySellprofit}% profit`);
              const sellStatus = await swapExactTokensForETHSupportingFeeOnTransferTokens({ tokenAddress: tokenKeyAddress, baseToken: WETH_ADDRESS, gasPrice: gasPrice, sellPercent: 80 });
              transactionStatus = false
              if(sellStatus){
                //update redis to first = 0
                updateTokenInfo(tokenKey, tokenInfo);
              }else {
                console.error(`======================Couldn't sell token ${tokenKeyAddress}. I will try to sell but if error consist then Please sell manually=======================`);
              }
            }else {
              console.log("Other tx in the way, let's wait sometime");
            }
            
          }
        }
        
      }
    }
  }
}, 60000); // Run every mins


web3.eth.net.isListening()
  .then(() => console.log("WebSocket connection established"))
  .catch((e) => console.error("WebSocket connection failed:", e));


// swapExactTokensForETHSupportingFeeOnTransferTokens({ tokenAddress: '0x11fE4B6AE13d2a6055C8D9cF65c55bac32B5d844', baseToken: WETH_ADDRESS, gasPrice: 10000000000 });
// swapExactETHForTokens({ tokenAddress: '0x11fE4B6AE13d2a6055C8D9cF65c55bac32B5d844', baseToken: WETH_ADDRESS, value: BigInt('100'), gasPrice: 10000000000 });
