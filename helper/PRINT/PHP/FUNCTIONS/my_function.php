<?php
date_default_timezone_set('Asia/Kolkata');
//---------Validate Email ID Pattern-----------//
function validateEmail($email)
{
    return !filter_var($email, FILTER_VALIDATE_EMAIL);
}

//---------Validate Domain By Email ID---------//
function mxrecordValidate($email)
{
    list($user, $domain) = explode('@', $email);
    $arr = dns_get_record($domain, DNS_MX);

    if ($arr[0]['host'] == $domain && !empty($arr[0]['target'])) {
        return $arr[0]['target'];
    }
}

//---------Word Limit---------//
function limit_text($text, $limit)
{
    if (str_word_count($text, 0) > $limit) {
        $words = str_word_count($text, 2);
        $pos = array_keys($words);
        $text = substr($text, 0, $pos[$limit]) . '...';
    }
    return $text;
}

//---------Real IP Address---------//
function getUserIP()
{
    if (isset($_SERVER["HTTP_CF_CONNECTING_IP"])) {
        $_SERVER['REMOTE_ADDR'] = $_SERVER["HTTP_CF_CONNECTING_IP"];
        $_SERVER['HTTP_CLIENT_IP'] = $_SERVER["HTTP_CF_CONNECTING_IP"];
    }
    $client = @$_SERVER['HTTP_CLIENT_IP'];
    $forward = @$_SERVER['HTTP_X_FORWARDED_FOR'];
    $remote = $_SERVER['REMOTE_ADDR'];

    if (filter_var($client, FILTER_VALIDATE_IP)) {
        $ip = $client;
    } elseif (filter_var($forward, FILTER_VALIDATE_IP)) {
        $ip = $forward;
    } else {
        $ip = $remote;
    }

    return $ip;
}

//--------- SMS OTP---------//
function randomOTP($length = 8)
{
    $intMin = 10 ** $length / 10;
    $intMax = 10 ** $length - 1;

    $generateTEXTCode = mt_rand($intMin, $intMax);

    return $generateTEXTCode;
}
//--------- SMS OTP REQUEST ID---------//
function getTokenKey($eOTPKey)
{
    $characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    $randomString = '';

    for ($i = 0; $i < $eOTPKey; $i++) {
        $index = rand(0, strlen($characters) - 1);
        $randomString .= $characters[$index];
    }
    return $randomString;
}

//

//--------- TIME AGO FUNCTION ---------//

function time_ago($timestamp)
{
    $time_ago = strtotime($timestamp);
    $current_time = time();
    $time_difference = $current_time - $time_ago;
    $seconds = $time_difference;
    $minutes = round($seconds / 60); // value 60 is seconds
    $hours = round($seconds / 3600); //value 3600 is 60 minutes * 60 sec
    $days = round($seconds / 86400); //86400 = 24 * 60 * 60;
    $weeks = round($seconds / 604800); // 7*24*60*60;
    $months = round($seconds / 2629440); //((365+365+365+365+366)/5/12)*24*60*60
    $years = round($seconds / 31553280); //(365+365+365+365+366)/5 * 24 * 60 * 60
    if ($seconds <= 60) {
        return "Just Now";
    } elseif ($minutes <= 60) {
        if ($minutes == 1) {
            return "1min ago";
        } else {
            return "$minutes min ago";
        }
    } elseif ($hours <= 24) {
        if ($hours == 1) {
            return "an hour ago";
        } else {
            return "$hours hrs ago";
        }
    } elseif ($days <= 7) {
        if ($days == 1) {
            return "yesterday";
        } else {
            return "$days days ago";
        }
    } elseif ($weeks <= 4.3) {
        //4.3 == 52/12
        if ($weeks == 1) {
            return "a week ago";
        } else {
            return "$weeks weeks ago";
        }
    } elseif ($months <= 12) {
        if ($months == 1) {
            return "a month ago";
        } else {
            return "$months months ago";
        }
    } else {
        if ($years == 1) {
            return "one year ago";
        } else {
            return "$years years ago";
        }
    }
}

//--------- OS FUNCTION ---------//

$user_agent = $_SERVER['HTTP_USER_AGENT'];

function getOS()
{
    global $user_agent;

    $os_platform = "Unknown OS Platform";

    $os_array = [
        '/windows nt 10/i' => 'Windows 10',
        '/windows nt 6.3/i' => 'Windows 8.1',
        '/windows nt 6.2/i' => 'Windows 8',
        '/windows nt 6.1/i' => 'Windows 7',
        '/windows nt 6.0/i' => 'Windows Vista',
        '/windows nt 5.2/i' => 'Windows Server 2003/XP x64',
        '/windows nt 5.1/i' => 'Windows XP',
        '/windows xp/i' => 'Windows XP',
        '/windows nt 5.0/i' => 'Windows 2000',
        '/windows me/i' => 'Windows ME',
        '/win98/i' => 'Windows 98',
        '/win95/i' => 'Windows 95',
        '/win16/i' => 'Windows 3.11',
        '/macintosh|mac os x/i' => 'Mac OS X',
        '/mac_powerpc/i' => 'Mac OS 9',
        '/linux/i' => 'Linux',
        '/ubuntu/i' => 'Ubuntu',
        '/iphone/i' => 'iPhone',
        '/ipod/i' => 'iPod',
        '/ipad/i' => 'iPad',
        '/android/i' => 'Android',
        '/blackberry/i' => 'BlackBerry',
        '/webos/i' => 'Mobile',
    ];

    foreach ($os_array as $regex => $value) {
        if (preg_match($regex, $user_agent)) {
            $os_platform = $value;
        }
    }

    return $os_platform;
}

function getBrowser()
{
    global $user_agent;

    $browser = "Unknown Browser";

    $browser_array = [
        '/msie/i' => 'Internet Explorer',
        '/firefox/i' => 'Firefox',
        '/safari/i' => 'Safari',
        '/chrome/i' => 'Chrome',
        '/edge/i' => 'Edge',
        '/opera/i' => 'Opera',
        '/netscape/i' => 'Netscape',
        '/maxthon/i' => 'Maxthon',
        '/konqueror/i' => 'Konqueror',
        '/mobile/i' => 'Handheld Browser',
    ];

    foreach ($browser_array as $regex => $value) {
        if (preg_match($regex, $user_agent)) {
            $browser = $value;
        }
    }

    return $browser;
}

//--------- SORT COUNT ---------//

if (!function_exists('sortcount')) {
    function sortcount(int $number): string
    {
        $suffixByNumber = function () use ($number) {
            if ($number < 1000) {
                return sprintf('%d', $number);
            }

            if ($number < 1000000) {
                return sprintf('%d%s', floor($number / 1000), 'K+');
            }

            if ($number >= 1000000 && $number < 1000000000) {
                return sprintf('%d%s', floor($number / 1000000), 'M+');
            }

            if ($number >= 1000000000 && $number < 1000000000000) {
                return sprintf('%d%s', floor($number / 1000000000), 'B+');
            }

            return sprintf('%d%s', floor($number / 1000000000000), 'T+');
        };

        return $suffixByNumber();
    }
}

//--------- URL 404 Track ---------//

function checkURL($url, array $options = [])
{
    if (empty($url)) {
        throw new Exception('URL is empty');
    }

    // list of HTTP status codes
    $httpStatusCodes = [
        100 => 'Continue',
        101 => 'Switching Protocols',
        102 => 'Processing',
        200 => 'OK',
        201 => 'Created',
        202 => 'Accepted',
        203 => 'Non-Authoritative Information',
        204 => 'No Content',
        205 => 'Reset Content',
        206 => 'Partial Content',
        207 => 'Multi-Status',
        208 => 'Already Reported',
        226 => 'IM Used',
        300 => 'Multiple Choices',
        301 => 'Moved Permanently',
        302 => 'Found',
        303 => 'See Other',
        304 => 'Not Modified',
        305 => 'Use Proxy',
        306 => 'Switch Proxy',
        307 => 'Temporary Redirect',
        308 => 'Permanent Redirect',
        400 => 'Bad Request',
        401 => 'Unauthorized',
        402 => 'Payment Required',
        403 => 'Forbidden',
        404 => 'Not Found',
        405 => 'Method Not Allowed',
        406 => 'Not Acceptable',
        407 => 'Proxy Authentication Required',
        408 => 'Request Timeout',
        409 => 'Conflict',
        410 => 'Gone',
        411 => 'Length Required',
        412 => 'Precondition Failed',
        413 => 'Payload Too Large',
        414 => 'Request-URI Too Long',
        415 => 'Unsupported Media Type',
        416 => 'Requested Range Not Satisfiable',
        417 => 'Expectation Failed',
        418 => 'I\'m a teapot',
        422 => 'Unprocessable Entity',
        423 => 'Locked',
        424 => 'Failed Dependency',
        425 => 'Unordered Collection',
        426 => 'Upgrade Required',
        428 => 'Precondition Required',
        429 => 'Too Many Requests',
        431 => 'Request Header Fields Too Large',
        449 => 'Retry With',
        450 => 'Blocked by Windows Parental Controls',
        500 => 'Internal Server Error',
        501 => 'Not Implemented',
        502 => 'Bad Gateway',
        503 => 'Service Unavailable',
        504 => 'Gateway Timeout',
        505 => 'HTTP Version Not Supported',
        506 => 'Variant Also Negotiates',
        507 => 'Insufficient Storage',
        508 => 'Loop Detected',
        509 => 'Bandwidth Limit Exceeded',
        510 => 'Not Extended',
        511 => 'Network Authentication Required',
        599 => 'Network Connect Timeout Error',
    ];

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_NOBODY, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);

    if (isset($options['timeout'])) {
        $timeout = (int) $options['timeout'];
        curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
    }

    curl_exec($ch);
    $returnedStatusCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    // if (array_key_exists($returnedStatusCode, $httpStatusCodes)) {
    //     return "URL: '{$url}' - Error code: {$returnedStatusCode} - Definition: {$httpStatusCodes[$returnedStatusCode]}";
    // } else {
    //     return "'{$url}' does not exist";
    // }
    if (array_key_exists($returnedStatusCode, $httpStatusCodes)) {
        return "URL: '{$url}' - Error code: {$returnedStatusCode} - Definition: {$httpStatusCodes[$returnedStatusCode]}";
    } else {
        return "'{$url}' does not exist";
    }
}
//==
function PHPSESToken($length)
{
    $token = "";
    $codeAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    $codeAlphabet .= "abcdefghijklmnopqrstuvwxyz";
    $codeAlphabet .= "0123456789";
    $max = strlen($codeAlphabet);

    for ($i = 0; $i < $length; $i++) {
        $token .= $codeAlphabet[random_int(0, $max - 1)];
    }
    return $token;
}

function sendSMS($number, $message, $route, $language)
{
    $curl = curl_init();

    curl_setopt_array($curl, [
        CURLOPT_URL => "https://api.msg91.com/api/sendhttp.php?authkey=342390AumRNwZyf5f6986dbP1&mobiles=$number&country=91&message=$message&sender=MSCORP&route=$route&unicode=$language",
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_ENCODING => "",
        CURLOPT_MAXREDIRS => 10,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
        CURLOPT_CUSTOMREQUEST => "GET",
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_SSL_VERIFYPEER => 0,
    ]);

    $response = curl_exec($curl);
    $err = curl_error($curl);

    curl_close($curl);
    return $response;
}
?>
